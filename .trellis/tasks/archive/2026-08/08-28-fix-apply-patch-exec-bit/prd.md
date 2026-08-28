# fix: apply_patch 原子写丢失文件可执行权限

## Goal

writeFileAtomic 用写临时文件+rename 覆盖的原子写策略，rename 是 inode 替换，会丢掉目标文件权限位（可执行位等）。修复为 rename 前从目标文件继承 mode。

## Requirements

- `writeFileAtomic` 在 rename 覆盖已存在文件前，从目标文件继承权限位（`mode & 0o7777`），写入临时文件，再 rename。
- 目标文件不存在（新文件 / add 操作）时行为不变：保持默认 umask 权限。
- EEXIST 重试分支（unlink 后 rename）仍保持原子性与清理语义。
- `AtomicWriteOperations` 扩展 `stat` / `chmod` 两个可注入操作，保持可测试性。

## Acceptance Criteria

- [ ] 对 mode 0755 的文件执行 update patch 后，文件权限仍为 0755（可执行位保留）。
- [ ] 对 mode 0644 的文件执行 update patch 后，权限仍为 0644。
- [ ] add 新文件权限行为不变（umask 默认值）。
- [ ] EEXIST 重试路径测试仍通过（自定义 operations 补齐 stat/chmod）。
- [ ] `npm test` 与 `npm run check`（typecheck + biome）全部通过。

## Notes

- 根因：`writeFileAtomic` 的「写临时文件 + rename 覆盖」中，rename 是 inode 级替换，临时文件默认 mode（0o666 & ~umask）不继承目标文件权限位，导致 0755 可执行文件被 update 后降为 0644。
- 修复：rename 前 `stat` 目标文件（ENOENT 跳过），将 `mode & 0o7777`（含 setuid/setgid/sticky）`chmod` 到临时文件再 rename；EEXIST 重试分支不受影响。
- 回归防线：`writeFileAtomic` 单测（executable / regular mode）+ `applyPatch` 端到端测试（update 可执行脚本保留 0755）。
- 同类风险：任何「写新临时文件再 rename」的原子写都必须继承目标 mode；move 覆盖已存在目标时同理。
