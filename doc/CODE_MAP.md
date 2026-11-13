# 代码地图 · 方法与契约

> 生成器与配置在本目录：`doc/codemap.mjs`、`doc/codemap.config.json`。
> 生成物：`doc/CODE_MAP_INDEX.md`、`doc/codemap/**`、`doc/.codemap-cache.json`。**只能由生成器写，禁止手改。**

## 1. 三层结构

```
AGENTS.md
  └─ doc/CODE_MAP_INDEX.md        模块总表（src / test / tools）
       └─ doc/codemap/<模块>.md   文件 → 符号页
            └─ 符号页              声明名 / 种类 / 行号
                 └─ src|test|tools/...js#L<行号>
```

`doc/codemap/hubs.md` 是“被引用最多”的概览页；本仓目前为空（见 §4）。

## 2. 命令

```bash
node doc/codemap.mjs                    # 增量生成（改代码后必跑）
node doc/codemap.mjs --check            # 只校验，漂移则退出码 1
node doc/codemap.mjs --module src       # 只刷新一个模块（缓存需有效）
node doc/codemap.mjs --find scan        # 符号定位：路径:行号
node doc/codemap.mjs --outline src/stats.js
node doc/codemap.mjs --map [--tokens N] # 预算内的枢纽概览
node doc/codemap.mjs --json --find ...  # 机器可读
```

查询命令只读缓存，不写文件。任何文件增删改后：生成 → `--check`，零漂移再提交。

## 3. 覆盖契约

| 项 | 值 |
| --- | --- |
| roots | `src`、`test`、`tools` |
| 扩展名 | `.js`（全部 CommonJS） |
| 排除 | `node_modules`、`dist`、`docs`、`doc`、`media`、`.vscode-test`、`.git` |
| 模块 | `src/` → `src`，`test/` → `test`，`tools/` → `tools` |
| JS 提取 | TypeScript 编译器 API：函数、类、方法、属性、变量声明、解构绑定 |
| 引用边 | 仅 ESM `import/export ... from`；**不识别 CommonJS `require()`** |
| 未索引 | `tools/make-icon.py`（见 §5）、Markdown/JSON/图片 |

**引用图为空是已知事实，不是故障。** 本仓 `src/*.js` 全部用 `require()`（共 20 处），生成器的正则只匹配 ESM 写法，所以 `edges = 0`、`hubs.md` 没有排名。**不要**据此推断“没有依赖”；需要真实依赖时用 `rg "require\(" src test tools`。

## 4. 已知基线（2026-11-13，v0.4.0）

```json
{"files":13,"symbols":674,"diagnostics":0,"parsed":13,"changed":19,"deleted":0,"pages":19,
 "edges":{"resolved":0,"unresolved":0,"ambiguous":0}}
```

- 模块：`src` 7 文件 / 387 符号；`test` 4 文件 / 180；`tools` 2 文件 / 107。
- 第二次生成 `changed=0`，`--check` 退出码 0（幂等已验证）。
- 抽查（`--find` 行号 = 源码声明行）：`UsageScanner` → `src/usage-events.js:101`；`summarize` → `src/stats.js:14`；`statusBarWanted` → `src/stats.js:96`；`html` → `src/webview.js:13`。
- 同名歧义：`statusBarWanted` 在 `src/stats.js:96` 与 `src/extension.js:514` 各有一份（后者是本地副本），`--find` 会同时返回，按路径区分。
- `src/webview.js` 只有 7 个顶层符号（主要是巨型 `html()` 函数），符号页小是正常的。

诊断数升高的常见原因：新语法超出 TypeScript 快照、或把非 JS 文件纳入 roots。**不要把诊断数硬调成 0**，先归类。

## 5. 依赖与解析恢复

生成器需要 `typescript`、`web-tree-sitter`、`tree-sitter-wasms`，本仓**没有**写入 `package.json`（保持扩展零依赖）：

```bash
npm install --no-save typescript@5.9.3 web-tree-sitter tree-sitter-wasms
```

- **必须固定 TypeScript 5.x**：实测 `typescript@7.0.2` 不再导出 `ts.ScriptTarget`，生成器报 `Cannot read properties of undefined (reading 'Latest')`。
- `node_modules/` 已被 `.gitignore` 忽略；新机器/清缓存后按上面命令恢复。
- `tools/make-icon.py` 暂不索引：`web-tree-sitter@0.27.2` 与 `tree-sitter-wasms@0.1.13` 的 Python 语法包 ABI 不兼容（`getDylinkMetadata` 失败）。需要时单独降级 `web-tree-sitter` 再试，或改用 Python 专用工具。

## 6. 未覆盖项（不得假装覆盖）

- CommonJS 依赖边、真实调用关系、类型推断、接口实现、宏展开。
- `require()` 解构出来的名字会被记为 `BindingElement` 符号（如 `UsageScanner` 在 `src/extension.js:8`），这是声明位置，不是定义位置。
- Python / Shell / 图片 / 配置 / 文档。
- 外部包（无 `node_modules` 索引）。

## 7. 完成清单

- [x] 生成器与配置落在 `doc/`
- [x] 首次生成：13 文件 / 674 符号 / 0 诊断 / 19 页
- [x] 幂等：第二次 `changed=0`
- [x] `--check` 退出码 0
- [x] 抽查 4 个符号的行号与源码一致
- [x] `AGENTS.md` 已接入代码地图段
- [x] `doc/codemap-guide.md` 已写
- [ ] 引用边（需生成器支持 CommonJS，非本仓可解）
