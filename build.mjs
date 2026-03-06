import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJs } from "terser";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(__filename);

const srcHtmlPath = path.join(projectRoot, "index.html");
const distDir = path.join(projectRoot, "dist");
const distAssetsDir = path.join(distDir, "assets");

const extractSingleTag = (html, tagName, predicate) => {
    const re = new RegExp(`<${tagName}([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "ig");
    let match;
    while ((match = re.exec(html))) {
        const attrs = match[1] || "";
        const body = match[2] || "";
        if (!predicate || predicate(attrs)) return { full: match[0], attrs, body };
    }
    return null;
};

const removeTagBlock = (html, fullTag) => html.replace(fullTag, "");

const removeMatches = (html, re) => html.replace(re, "");

const insertAfter = (html, needle, insertion) => {
    const idx = html.indexOf(needle);
    if (idx === -1) throw new Error(`Tidak menemukan marker: ${needle}`);
    return html.slice(0, idx + needle.length) + insertion + html.slice(idx + needle.length);
};

const insertBefore = (html, needle, insertion) => {
    const idx = html.indexOf(needle);
    if (idx === -1) throw new Error(`Tidak menemukan marker: ${needle}`);
    return html.slice(0, idx) + insertion + html.slice(idx);
};

const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "upgrade-insecure-requests"
].join("; ");

const runCmd = (cmd, args, cwd) => {
    const res = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true });
    if (res.status !== 0) throw new Error(`Gagal menjalankan: ${cmd} ${args.join(" ")}`);
};

const ensureEmptyDir = async (dir) => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
};

const run = async () => {
    const srcHtml = await readFile(srcHtmlPath, "utf8");

    const styleTag = extractSingleTag(srcHtml, "style");
    if (!styleTag) throw new Error("Tag <style> tidak ditemukan.");

    const scriptTag = extractSingleTag(srcHtml, "script", (attrs) =>
        attrs.toLowerCase().includes('type="module"')
    );
    if (!scriptTag) throw new Error('Tag <script type="module"> tidak ditemukan.');

    await ensureEmptyDir(distAssetsDir);

    const tmpRoot = path.join(
        os.tmpdir(),
        `grokgen-build-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    await mkdir(tmpRoot, { recursive: true });

    try {
        const contentHtml = removeTagBlock(removeTagBlock(srcHtml, styleTag.full), scriptTag.full);
        const contentHtmlPath = path.join(tmpRoot, "content.html");
        const contentJsPath = path.join(tmpRoot, "content.js");
        const inputCssPath = path.join(tmpRoot, "input.css");
        const configPath = path.join(tmpRoot, "tailwind.config.cjs");

        await writeFile(contentHtmlPath, contentHtml, "utf8");
        await writeFile(contentJsPath, scriptTag.body, "utf8");
        await writeFile(
            inputCssPath,
            `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${styleTag.body}\n`,
            "utf8"
        );
        await writeFile(
            configPath,
            `module.exports={content:["./content.html","./content.js"],theme:{extend:{}},plugins:[]};\n`,
            "utf8"
        );

        const tailwindCli = path.join(projectRoot, "node_modules", "tailwindcss", "lib", "cli.js");
        const outCssPath = path.join(distAssetsDir, "app.min.css");
        runCmd(process.execPath, [tailwindCli, "-c", configPath, "-i", inputCssPath, "-o", outCssPath, "--minify"], tmpRoot);

        const jsMin = await minifyJs(scriptTag.body, {
            module: true,
            toplevel: true,
            compress: { passes: 3, drop_console: true, drop_debugger: true },
            mangle: { toplevel: true }
        });
        if (!jsMin.code) throw new Error("Minifikasi JS gagal.");
        await writeFile(path.join(distAssetsDir, "app.min.js"), jsMin.code, "utf8");

        let prodHtml = contentHtml;
        prodHtml = removeMatches(prodHtml, /<script[^>]+cdn\.tailwindcss\.com[^>]*><\/script>\s*/gi);
        prodHtml = removeMatches(prodHtml, /<script[^>]+cdnjs\.cloudflare\.com\/ajax\/libs\/jszip[^>]*><\/script>\s*/gi);
        prodHtml = removeMatches(prodHtml, /<link[^>]+fonts\.googleapis\.com[^>]*>\s*/gi);
        prodHtml = removeMatches(prodHtml, /<link[^>]+fonts\.gstatic\.com[^>]*>\s*/gi);
        prodHtml = insertAfter(prodHtml, '<meta charset="UTF-8">', `\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);
        prodHtml = insertBefore(prodHtml, "</head>", `\n    <link rel="stylesheet" href="./assets/app.min.css">`);
        prodHtml = insertBefore(prodHtml, "</body>", `\n<script type="module" src="./assets/app.min.js"></script>\n`);

        const minHtml = await minifyHtml(prodHtml, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeEmptyAttributes: true,
            sortAttributes: true,
            sortClassName: true,
            minifyCSS: false,
            minifyJS: false
        });

        await writeFile(path.join(distDir, "index.html"), minHtml, "utf8");
    } finally {
        await rm(tmpRoot, { recursive: true, force: true });
    }
};

await run();
