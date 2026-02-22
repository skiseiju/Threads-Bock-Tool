const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'threads_block_tool.user.js');

const ORDER = [
    'config.js',
    'utils.js',
    'storage.js',
    'ui.js',
    'core.js',
    'worker.js',
    'main.js'
];

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

let content = '';

// Header
content += `// ==UserScript==
// @name         留友封 (Threads 封鎖工具 v2.0 Dev)
// @namespace    http://tampermonkey.net/
// @version      2.0.0.8
// @description  Modular Refactor Build
// @author       海哥
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=threads.net
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

`;

ORDER.forEach(file => {
    const filePath = path.join(SRC_DIR, file);
    let code = fs.readFileSync(filePath, 'utf8');

    // Simple Transpilation for concatenation
    // 1. Remove imports
    code = code.replace(/^import .* from .*/gm, '');

    // 2. Remove 'export const' -> 'const' or 'window.Module ='
    // We want them to be local variables in the IIFE so they can reference each other.
    // 'export const CONFIG' -> 'const CONFIG'
    code = code.replace(/export const/g, 'const');

    // 3. Remove 'export default'
    code = code.replace(/export default/g, '');

    content += `\n// --- ${file} ---\n`;
    content += code + '\n';
});

content += `\n})();`;

fs.writeFileSync(OUT_FILE, content);
console.log(`Build complete: ${OUT_FILE}`);
