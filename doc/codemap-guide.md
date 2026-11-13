# 代码地图使用指南

> 目的：用 1–3 次工具调用拿到 `路径:行号`，不要全仓盲扫。
> 契约、基线、未覆盖项见 `doc/CODE_MAP.md`。

## 定位顺序

1. **不知道从哪下手** → `node doc/codemap.mjs --map`；本仓引用图为空，直接看 `doc/CODE_MAP_INDEX.md` 的模块表。
2. **知道符号名** → `node doc/codemap.mjs --find <名字>`。
3. **知道文件** → `node doc/codemap.mjs --outline <文件>`。
4. **都没有** → `doc/CODE_MAP_INDEX.md` → `doc/codemap/<模块>.md` → 符号页 → 源码 `#L行号`。

只读命中段源码，不要把整张地图塞进上下文。

## 模块速查

| 模块 | 目录 | 符号数 | 主要入口 |
| --- | --- | ---: | --- |
| `src` | `src/` | 387 | `activate`（extension.js）、`UsageScanner`（usage-events.js）、`LogScanner`（parser.js） |
| `test` | `test/` | 180 | 四个 `*.test.js`，Node 直接执行 |
| `tools` | `tools/` | 107 | `smoke-activate.js`、`preview.js`；`make-icon.py` 未索引 |

## 常用命令

```bash
node doc/codemap.mjs --find buildPayload
node doc/codemap.mjs --outline src/extension.js
node doc/codemap.mjs --map --tokens 800
node doc/codemap.mjs --module src
node doc/codemap.mjs && node doc/codemap.mjs --check
```

## 必做清单

- 改任何 `src/ test/ tools/` 下的 `.js` 后：`node doc/codemap.mjs` → `--check`，零漂移再提交。
- 新增文件会自动进入所属模块；新增目录需要同步 `doc/codemap.config.json` 的 `roots` / `modules`。
- 生成物随代码提交；评审时当 diff 看。
- 生成器报依赖缺失：`npm install --no-save typescript@5.9.3 web-tree-sitter tree-sitter-wasms`。

## FAQ

**为什么 hubs 页是空的？**
本仓是 CommonJS，生成器只识别 ESM `import`。`require()` 不计入引用边，所以 `edges = 0`。这是已知限制，不代表模块之间没有依赖——用 `rg "require\("` 查。

**`--find activate` 为什么返回多行？**
同名声明（定义、导入解构、测试里的副本）都会列出；看 `kind` 和路径，`FunctionDeclaration` 通常是定义。

**为什么 `src/webview.js` 只有 7 个符号？**
面板 HTML 基本都在一个 `html()` 函数里，顶层声明少。要看内部逻辑，直接读该函数或用 `rg`。

**缓存坏了怎么办？**
删 `doc/.codemap-cache.json` 后全量生成；结果不变，只是慢一点。

**能索引 `.py` 吗？**
当前不能：`web-tree-sitter@0.27.2` 与 `tree-sitter-wasms@0.1.13` 的 Python 语法包 ABI 不兼容。`tools/make-icon.py` 只有 84 行，直接读即可。
