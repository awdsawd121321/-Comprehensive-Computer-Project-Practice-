# Protobuf 版本冲突 - 快速解决方案

## 🎯 当前情况

你已经安装了 `protobuf==3.19.6`，但 pip 显示警告：

```
tensorboardx 2.6.4 requires protobuf>=3.20, but you have protobuf 3.19.6 which is incompatible.
```

## ✅ 解决方案：测试实际功能

**重要**：pip 的警告 ≠ 实际错误。关键是测试 FunASR 是否能正常工作。

### 步骤 1：测试 FunASR

```bash
conda activate emobit
./scripts/start_funasr.sh
```

### 步骤 2：判断结果

**如果 FunASR 能正常启动和识别**：
- ✅ **问题已解决**，可以忽略警告
- 警告不影响实际功能
- 继续使用即可

**如果 FunASR 报错**（与 protobuf 相关）：
- 继续看下面的备选方案

## 🔧 备选方案（仅在 FunASR 报错时使用）

### 方案 A：使用环境变量

修改 `scripts/start_funasr.sh`，在启动前添加：

```bash
# 在脚本的第 56 行之前添加
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
python "$SERVER_SCRIPT"
```

### 方案 B：降级 tensorboardx

```bash
pip install tensorboardx==2.5.1
```

然后重新测试 FunASR。

## 📝 总结

1. **先测试**：运行 `./scripts/start_funasr.sh`
2. **如果能用**：忽略警告，继续使用
3. **如果报错**：尝试备选方案

**记住**：pip 警告是预防性的，不代表代码无法运行。实际测试最重要！
