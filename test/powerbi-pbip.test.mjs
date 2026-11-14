// skills/powerbi-pbip/scripts/desktop-reload.mjs の試験。Desktop Bridge の偽物（JSON-RPC を返すパイプ）を立て、
// 未保存の変更があるか分からないときに読み直さないこと、Desktop を選べないときに止まることを確かめる。
//   node --test test/powerbi-pbip.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encodeMessage, decodeMessages, listBridgePids, parseArgs, safeToReload, run } from "../skills/powerbi-pbip/scripts/desktop-reload.mjs";

test("見出しの長さは本文のバイト数（日本語を含む）", () => {
    const frame = encodeMessage({ jsonrpc: "2.0", id: "1", result: { path: "月次実績" } });
    const [head, body] = frame.toString("utf8").split("\r\n\r\n");
    assert.equal(head, `Content-Length: ${Buffer.byteLength(body, "utf8")}`);
});

test("分かれて届いたメッセージも、そろってから取り出す", () => {
    const a = encodeMessage({ id: "a", result: 1 });
    const b = encodeMessage({ id: "b", result: { success: true } });
    const all = Buffer.concat([a, b]);
    const first = decodeMessages(all.subarray(0, a.length + 5));
    assert.deepEqual(first.messages, [{ id: "a", result: 1 }]);
    const second = decodeMessages(Buffer.concat([first.rest, all.subarray(a.length + 5)]));
    assert.deepEqual(second.messages, [{ id: "b", result: { success: true } }]);
    assert.equal(second.rest.length, 0);
});

test("Bridge のパイプだけをプロセス ID にする", () => {
    assert.deepEqual(listBridgePids(["pbi-desktop-bridge-33752", "other-pipe", "pbi-desktop-bridge-x", "pbi-desktop-bridge-28140"]), ["33752", "28140"]);
});

test("--pid は数字だけを受け、値が無い・ほかの引数が続くときは誤りにする", () => {
    assert.deepEqual(parseArgs(["--pid", "123"]), { pid: "123", reloadModelDefinition: true });
    assert.deepEqual(parseArgs(["--report-only"]), { pid: undefined, reloadModelDefinition: false });
    assert.ok(parseArgs(["--pid"]).error);
    assert.ok(parseArgs(["--pid", "--report-only"]).error);
    assert.ok(parseArgs(["--pid", "12a"]).error);
    assert.ok(parseArgs(["--reload"]).error);
});

test("読み直してよいのは、未保存の変更が無いと分かり、ファイルが分かるときだけ", () => {
    assert.equal(safeToReload({ hasUnsavedChanges: false, currentFilePath: "C:/a.pbip" }), true);
    assert.equal(safeToReload({ hasUnsavedChanges: true, currentFilePath: "C:/a.pbip" }), false);
    assert.equal(safeToReload({ hasUnsavedChanges: null, currentFilePath: "C:/a.pbip" }), false);
    assert.equal(safeToReload({ currentFilePath: "C:/a.pbip" }), false);
    assert.equal(safeToReload({ details: { hasUnsavedChanges: false }, currentFilePath: "C:/a.pbip" }), false);
    assert.equal(safeToReload({ hasUnsavedChanges: false }), false);
    assert.equal(safeToReload(null), false);
});

// Bridge の偽物。state に返す値を決め、受け取ったメソッドと引数を calls に残す。silent なら応答しない
async function fakeBridge({ state, reload = { success: true }, silent = false }) {
    const pipe = process.platform === "win32" ? `\\\\.\\pipe\\powerbi-pbip-test-${randomUUID()}` : path.join(os.tmpdir(), `powerbi-pbip-${randomUUID()}.sock`);
    const calls = [];
    const server = net.createServer(socket => {
        let buffer = Buffer.alloc(0);
        socket.on("data", chunk => {
            const { messages, rest } = decodeMessages(Buffer.concat([buffer, chunk]));
            buffer = rest;
            for (const m of messages) {
                calls.push({ method: m.method, args: m.params.args });
                if (silent) continue;
                const result = m.method === "application.state.get/v1" ? state : reload;
                socket.write(encodeMessage({ jsonrpc: "2.0", id: m.id, result }));
            }
        });
    });
    await new Promise(resolve => server.listen(pipe, resolve));
    return { pipe, calls, close: () => new Promise(resolve => server.close(resolve)) };
}

async function runWith(bridge, argv = [], extra = {}) {
    const out = [];
    const code = await run(argv, { listPids: () => ["4242"], pipePath: () => bridge.pipe, log: s => out.push(s), error: s => out.push(s), ...extra });
    return { code, out: out.join("\n") };
}

test("未保存の変更が無ければ、モデルごと読み直す", async () => {
    const bridge = await fakeBridge({ state: { hasUnsavedChanges: false, currentFilePath: "C:/work/売上.pbip" } });
    try {
        const { code } = await runWith(bridge);
        assert.equal(code, 0);
        assert.deepEqual(bridge.calls.map(c => c.method), ["application.state.get/v1", "file.reload/v1"]);
        assert.deepEqual(bridge.calls[1].args, { reloadModelDefinition: true });
    } finally {
        await bridge.close();
    }
});

test("--report-only では reloadModelDefinition を false で送る", async () => {
    const bridge = await fakeBridge({ state: { hasUnsavedChanges: false, currentFilePath: "C:/work/売上.pbip" } });
    try {
        assert.equal((await runWith(bridge, ["--report-only"])).code, 0);
        assert.deepEqual(bridge.calls[1].args, { reloadModelDefinition: false });
    } finally {
        await bridge.close();
    }
});

for (const [name, state] of [
    ["未保存の変更がある", { hasUnsavedChanges: true, currentFilePath: "C:/work/売上.pbip" }],
    ["未保存かが応答に無い", { currentFilePath: "C:/work/売上.pbip" }],
    ["未保存かが null の", { hasUnsavedChanges: null, currentFilePath: "C:/work/売上.pbip" }],
    ["開いているファイルが分からない", { hasUnsavedChanges: false }],
]) {
    test(`${name}ときは、読み直さずに 1 で止まる`, async () => {
        const bridge = await fakeBridge({ state });
        try {
            assert.equal((await runWith(bridge)).code, 1);
            assert.deepEqual(bridge.calls.map(c => c.method), ["application.state.get/v1"]);
        } finally {
            await bridge.close();
        }
    });
}

test("読み直しが success を返さなければ 1", async () => {
    const bridge = await fakeBridge({ state: { hasUnsavedChanges: false, currentFilePath: "C:/a.pbip" }, reload: { success: false } });
    try {
        assert.equal((await runWith(bridge)).code, 1);
    } finally {
        await bridge.close();
    }
});

test("応答が来なければ、時間切れで失敗する（待ち続けない）", async () => {
    const bridge = await fakeBridge({ silent: true });
    try {
        await assert.rejects(runWith(bridge, [], { timeoutMs: 300 }), /応答が無い/);
        assert.deepEqual(bridge.calls.map(c => c.method), ["application.state.get/v1"]);
    } finally {
        await bridge.close();
    }
});

test("Desktop が 0 個・2 個以上なら、つながずに 2 で止まる。--pid の誤りも 2", async () => {
    const never = () => assert.fail("つないではいけない");
    const quiet = { log: () => {}, error: () => {}, pipePath: never };
    assert.equal(await run([], { ...quiet, listPids: () => [] }), 2);
    assert.equal(await run([], { ...quiet, listPids: () => ["1", "2"] }), 2);
    assert.equal(await run(["--pid"], { ...quiet, listPids: () => ["1"] }), 2);
});
