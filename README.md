# 企通宝 Electron 客户端

企通宝桌面客户端（Electron），支持 Windows / Linux 构建，功能范围与 `QitongbaoMac` 对齐。

## 仓库

- GitHub：https://github.com/sukiyou-seven/seraphim-zhihuishaghui-electron
- 主项目：https://github.com/sukiyou-seven/seraphim-zhihuishanghui

## 开发

```bash
git clone https://github.com/sukiyou-seven/seraphim-zhihuishaghui-electron.git
cd seraphim-zhihuishaghui-electron
npm install
npm start
```

默认连接生产服务端 `https://qserver.deepbit001.com`，登录页可以修改 API 地址。

## 构建

```bash
npm run build:win     # Windows NSIS 安装包
npm run build:linux   # Linux AppImage + deb
npm run dist          # Windows + Linux
```

产物输出到 `dist/`。

## GitHub Actions

推送 `v*` 标签会触发 `.github/workflows/release.yml`：

1. 在 Windows 和 Linux 上安装依赖并构建；
2. 上传安装包；
3. 创建 GitHub Release 并附带构建产物。

也可以手动触发 `workflow_dispatch`。

## 版本

当前统一版本：`1.0.10012`
