# 文件格式详细参考

本文档是 FileSkill 的补充参考，提供各文件格式的详细处理说明。
当 SKILL.md 中的简要表格不足以判断时，读取此文档获取更多信息。

---

## 纯文本文件（直接读写）

以下扩展名视为纯文本，使用 UTF-8 编码直接读取：

### 文档类
`.txt` `.md` `.markdown` `.csv` `.tsv` `.log`

### 代码类
`.js` `.ts` `.jsx` `.tsx` `.mjs` `.cjs` `.py` `.rb` `.go` `.rs` `.java` `.c` `.cpp` `.h` `.hpp`

### Web 前端
`.html` `.htm` `.css` `.scss` `.less` `.sass` `.vue` `.svelte` `.astro`

### 配置 & 数据
`.json` `.jsonl` `.xml` `.yaml` `.yml` `.toml` `.ini` `.cfg` `.conf`

### 脚本 & Shell
`.sh` `.bash` `.zsh` `.fish`

### 查询语言
`.sql` `.graphql` `.gql`

### 特殊文件
`.env` `.gitignore` `.editorconfig` 以及无扩展名文件（如 Dockerfile、Makefile）

**大小限制**：单文件最大读取 512KB，超出部分会被截断。

---

## 富文档提取（只读，不可写入/编辑）

### PDF (.pdf)
- 使用 `pdf-parse` 库提取文本内容
- 仅提取文字，不包含图片、表格格式
- 扫描版 PDF（图片型）可能无法提取文字

### Word (.docx)
- 使用 `mammoth` 库提取原始文本
- 保留段落结构，不保留格式（粗体、颜色等）
- 不支持旧版 .doc 格式

### Excel (.xlsx)
- 使用 `xlsx` 库读取
- 每个 Sheet 导出为 CSV 格式文本
- 公式显示计算结果（非公式本身）
- 不支持旧版 .xls 格式

---

## 不受支持的格式

以下格式不应尝试读取（会返回乱码或错误）：

- **图片**：.png, .jpg, .gif, .svg, .webp
- **视频/音频**：.mp4, .mp3, .wav, .avi
- **可执行文件**：.exe, .app, .dmg
- **压缩包**：.zip, .tar, .gz, .rar
- **二进制数据**：.bin, .dat, .db, .sqlite
