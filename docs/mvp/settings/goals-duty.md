# settings 模块 · goals-duty

> 模块路径：`src/lib/app-settings/`、`src/app/api/settings/`、`src/components/settings/`
> 状态：Web 首版已确认；Electron 原生能力后置。

## 1. Design Goals

1. 让用户在 Web 与未来桌面版中看到一致的数据保留、导出和应用信息入口。
2. 将非敏感偏好与 API Key、业务 SQLite、浏览器语言偏好分离，避免职责和安全边界混淆。
3. 让自动清理和项目导出可预测：不清理收藏图片，不在导出时等待进行中的生成。

## 2. Duties

1. 在用户配置目录原子读写非敏感 `settings.json`，当前保存图片保留天数或“永不”。
2. 向 storage cleanup 提供当前保留策略；降低保留天数后，下一轮清理处理所有已过期且未收藏的既有图片。
3. 提供本地数据占用汇总，以及按 Project / Session 层级导出已完成图片与历史的 ZIP。
4. 在 Web 设置页展示浏览器下载约束、桌面专属能力的不可用状态、版本与许可证信息。

## 3. Non-Duties

1. 不管理界面语言；语言切换继续由既有浏览器 localStorage 行为负责。
2. 不保存、显示、导出或删除 Provider API Key；凭据继续由 `user-config` 与 Provider 页面负责。
3. 不提供“清除全部本地数据”或批量删除历史；已有的单图、单次生成删除职责不变。
4. Web 阶段不选择下载目录、不打开本机文件夹、不检查或安装更新；这些由未来的 Electron runtime 承担。
