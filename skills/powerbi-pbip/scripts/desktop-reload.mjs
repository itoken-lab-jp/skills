#!/usr/bin/env node
/**
 * 開いている Power BI Desktop に、PBIP をモデルの定義ごと読み直させる（Desktop Bridge の file.reload/v1）。
 *
 *   node <この SKILL.md のあるフォルダー>/scripts/desktop-reload.mjs [--pid <PBIDesktop のプロセス ID>] [--report-only]
 *
 * 公式の CLI（@microsoft/powerbi-desktop-bridge-cli 1.0.0）の `powerbi-desktop reload` は reloadModelDefinition に
 * 常に false を渡し（dist/cli.js）、TMDL の変更（メジャーを足すなど）を読み直さない。2026-10-06 に Desktop 2.158.1177.0 で、
 * true で呼ぶと足したメジャーが読まれ、CLI では「フィールドに問題があります」になることを確かめた。
 * データ（cache.abf）はどちらでも読み直さない。M の式の値を変えたら、Desktop のホームの「更新」が要る。
 *
 * 通信は名前付きパイプ \\.\pipe\pbi-desktop-bridge-<pid> の JSON-RPC 2.0（Content-Length の見出しと本文）。
 * 読み直す前に application.state.get/v1 を呼び、未保存の変更が無いと分かったときだけ読み直す（読み直すと、Desktop の中の
 * 未保存の変更が確認なしに捨てられる。2026-10-07 に確かめた）。hasUnsavedChanges が false でない（true・無い・null）とき、
 * currentFilePath が無いときは止める。
 *
 * 終了コード：0 読み直した、1 止めた・読み直しに失敗した、2 使い方の誤り・Desktop を選べない
 */
import fs from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const PIPE_DIR = "\\\\.\\pipe\\";
const PIPE_PREFIX = "pbi-desktop-bridge-";
const TIMEOUT_MS = 60_000; // reload は 7 秒ほどで返った（2026-10-06）

/** JSON-RPC のメッセージを Content-Length の見出しつきで書く */
export function encodeMessage(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** 受け取ったバイト列から、そろったメッセージを取り出す。残りは rest で返す */
export function decodeMessages(buffer) {
    const messages = [];
    let rest = buffer;
    for (;;) {
        const end = rest.indexOf("\r\n\r\n");
        if (end < 0) break;
        const match = /Content-Length:\s*(\d+)/i.exec(rest.subarray(0, end).toString("ascii"));
        if (!match) throw new Error("Content-Length の無い見出しを受け取った");
        const length = Number(match[1]);
        if (rest.length < end + 4 + length) break;
        messages.push(JSON.parse(rest.subarray(end + 4, end + 4 + length).toString("utf8")));
        rest = rest.subarray(end + 4 + length);
    }
    return { messages, rest };
}

/** 開いている Desktop の Bridge のプロセス ID */
export function listBridgePids(entries = fs.readdirSync(PIPE_DIR)) {
    return entries.filter(name => name.startsWith(PIPE_PREFIX)).map(name => name.slice(PIPE_PREFIX.length)).filter(pid => /^\d+$/.test(pid));
}

/** 引数を読む。誤りは error に入れる */
export function parseArgs(argv) {
    const args = { pid: undefined, reloadModelDefinition: true };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--report-only") args.reloadModelDefinition = false;
        else if (argv[i] === "--pid") {
            const value = argv[++i];
            if (!value || !/^\d+$/.test(value)) return { error: "--pid にはプロセス ID（数字）を渡す" };
            args.pid = value;
        } else return { error: `知らない引数：${argv[i]}` };
    }
    return args;
}

/** 読み直してよいか。未保存の変更が無いと分かり、開いているファイルが分かるときだけ true */
export function safeToReload(state) {
    return state?.hasUnsavedChanges === false && typeof state?.currentFilePath === "string" && state.currentFilePath !== "";
}

function connect(path) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(path);
        socket.once("connect", () => {
            socket.off("error", reject);
            resolve(socket);
        });
        socket.once("error", reject);
    });
}

function request(socket, method, args, timeoutMs) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        const done = (fn, value) => {
            clearTimeout(timer);
            socket.off("data", onData);
            socket.off("close", onClose);
            socket.off("error", onError);
            fn(value);
        };
        const onData = chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            let decoded;
            try {
                decoded = decodeMessages(buffer);
            } catch (error) {
                return done(reject, error);
            }
            buffer = decoded.rest;
            const reply = decoded.messages.find(m => m.id === id);
            if (!reply) return;
            if (reply.error) done(reject, new Error(`${method}: ${reply.error.message} (${reply.error.code})`));
            else done(resolve, reply.result);
        };
        const onClose = () => done(reject, new Error(`${method}: 応答の前にパイプが閉じた`));
        const onError = error => done(reject, error);
        const timer = setTimeout(() => done(reject, new Error(`${method}: ${timeoutMs / 1000} 秒待っても応答が無い`)), timeoutMs);
        socket.on("data", onData);
        socket.on("close", onClose);
        socket.on("error", onError);
        socket.write(encodeMessage({ jsonrpc: "2.0", id, method, params: { client: "powerbi-pbip", clientActivityId: randomUUID(), args } }));
    });
}

/**
 * 本体。試験では options で、Desktop の一覧（listPids）・つなぐ先（pipePath）・出力（log・error）・時間切れを差し替える
 * @returns {Promise<number>} 終了コード
 */
export async function run(argv, options = {}) {
    const { listPids = listBridgePids, pipePath = pid => PIPE_DIR + PIPE_PREFIX + pid, log = console.log, error = console.error, timeoutMs = TIMEOUT_MS } = options;
    const args = parseArgs(argv);
    if (args.error) {
        error(args.error);
        return 2;
    }
    let pid = args.pid;
    if (!pid) {
        const pids = listPids();
        if (pids.length !== 1) {
            error(pids.length ? `Desktop が ${pids.length} 個開いている（${pids.join(", ")}）。--pid で選ぶ` : "Desktop Bridge につながる Desktop が無い");
            return 2;
        }
        pid = pids[0];
    }
    const socket = await connect(pipePath(pid));
    try {
        const state = await request(socket, "application.state.get/v1", {}, timeoutMs);
        if (!safeToReload(state)) {
            error(state?.hasUnsavedChanges === true
                ? `未保存の変更がある（${state.currentFilePath}）。保存してから読み直す`
                : `未保存の変更が無いと確かめられない（応答：${JSON.stringify(state)}）。読み直さずに止める`);
            return 1;
        }
        const result = await request(socket, "file.reload/v1", { reloadModelDefinition: args.reloadModelDefinition }, timeoutMs);
        log(JSON.stringify({ pid: Number(pid), currentFilePath: state.currentFilePath, reloadModelDefinition: args.reloadModelDefinition, result }));
        return result?.success ? 0 : 1;
    } finally {
        socket.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run(process.argv.slice(2)).then(code => process.exit(code), err => {
        console.error(err.message);
        process.exit(1);
    });
}
