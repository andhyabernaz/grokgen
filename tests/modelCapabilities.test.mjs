import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const extractArrowFn = (source, name) => {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*(\\([\\s\\S]*?\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\});`);
    const m = source.match(re);
    if (!m) throw new Error(`Tidak menemukan fungsi: ${name}`);
    return m[1];
};

const loadFns = async () => {
    const html = await readFile(path.join(projectRoot, "index.html"), "utf8");
    const isModalityUnsupportedErrorSrc = extractArrowFn(html, "isModalityUnsupportedError");
    const buildUnsupportedModalityMessageSrc = extractArrowFn(html, "buildUnsupportedModalityMessage");
    const isModalityUnsupportedError = new Function(`return (${isModalityUnsupportedErrorSrc});`)();
    const buildUnsupportedModalityMessage = new Function(`return (${buildUnsupportedModalityMessageSrc});`)();
    return { isModalityUnsupportedError, buildUnsupportedModalityMessage };
};

test("isModalityUnsupportedError mengenali error IMAGE", async () => {
    const { isModalityUnsupportedError } = await loadFns();
    assert.equal(isModalityUnsupportedError("Model does not support response modalities: IMAGE", "IMAGE"), true);
    assert.equal(isModalityUnsupportedError("not supported: image output", "IMAGE"), true);
    assert.equal(isModalityUnsupportedError("HTTP 500", "IMAGE"), false);
});

test("buildUnsupportedModalityMessage berisi konteks model + modality", async () => {
    const { buildUnsupportedModalityMessage } = await loadFns();
    const msg = buildUnsupportedModalityMessage("gemini-1.5-flash", "IMAGE");
    assert.equal(msg.includes("gemini-1.5-flash"), true);
    assert.equal(msg.toLowerCase().includes("tidak mendukung"), true);
    assert.equal(msg.toLowerCase().includes("gambar"), true);
});

