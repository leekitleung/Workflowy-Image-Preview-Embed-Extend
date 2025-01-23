# Workflowy Image Preview, Embed & Extend

一个用于增强 Workflowy 功能的 Tampermonkey 脚本，支持图片预览和嵌入式内容展示。

## 功能特性

### 图片预览
支持以下类型的图片链接自动预览：
- 标准图片格式（jpg、jpeg、png、gif、svg、webp）
- Twitter 图片
- 微信公众号图片
- 花瓣网图片
- 小红书图片

### 嵌入式内容
支持以下平台的内容嵌入：
- 墨刀（modao.cc）
- 哔哩哔哩视频（支持 BV 号和 av 号）
- MasterGo 设计稿
- Figma 设计稿
- 腾讯 CoDesign

## 安装方法

1. 首先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 Tampermonkey 图标，选择"创建新脚本"
3. 将本仓库中的脚本内容复制粘贴到编辑器中
4. 点击保存即可使用

## 使用方法

安装脚本后，只需在 Workflowy 中粘贴支持的链接，脚本会自动：
- 为图片链接创建预览
- 为支持的平台链接创建嵌入式预览

## 配置选项

可以通过修改 `CONFIG` 对象来自定义以下参数：
- `previewWidth`: 预览窗口宽度（默认：720px）
- `previewHeight`: 预览窗口高度（默认：540px）
- `processingDelay`: 处理延迟时间（默认：1000ms）
- `retryDelay`: 重试延迟时间（默认：500ms）


## 版本历史

### V0.17
- 添加小红书图片支持
- 优化性能和稳定性

## 许可证

MIT License

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 注意事项

- 脚本仅在 workflowy.com 和 beta.workflowy.com 域名下运行
- 部分功能可能受到目标网站的跨域限制
