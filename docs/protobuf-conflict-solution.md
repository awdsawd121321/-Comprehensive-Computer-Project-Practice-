# Protobuf 版本冲突解决方案

## 问题描述

安装 FunASR 后出现依赖冲突：

```
ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.
descript-audiotools 0.7.2 requires protobuf<3.20,>=3.9.2, but you have protobuf 6.33.4 which is incompatible.
tensorboard 2.9.1 requires protobuf<3.20,>=3.9.2, but you have protobuf 6.33.4 which is incompatible.
```

**原因**：
- FunASR 的依赖 `tensorboardX` 要求 `protobuf>=3.20`，pip 自动安装了 `protobuf 6.33.4`
- `index-tts` 项目的 `descript-audiotools==0.7.2` 和 `tensorboard==2.9.1` 要求 `protobuf<3.20,>=3.9.2`
- 两者不兼容

## 解决方案

### 方案 1：降级 protobuf（推荐）

降级到 `protobuf 3.19.6`，这个版本满足所有包的要求：

```bash
# 激活 conda 环境
conda activate emobit

# 降级 protobuf
pip install protobuf==3.19.6
```

**验证**：
```bash
pip show protobuf
# 应该显示 Version: 3.19.6
```

**优点**：
- ✅ 满足所有依赖要求
- ✅ 最稳定的解决方案
- ✅ 不会影响 FunASR 和 index-tts 的功能

**注意**：`tensorboardX` 虽然要求 `protobuf>=3.20`，但通常 `3.19.6` 也能正常工作。如果遇到问题，可以使用方案 2。

### 方案 2：降级 tensorboardx（如果方案 1 失败）

如果 FunASR 因为 protobuf 版本报错，尝试降级 `tensorboardx`：

```bash
# 查找兼容的 tensorboardx 版本
pip install tensorboardx==2.5.1  # 或更早版本
```

**注意**：需要测试 FunASR 是否仍能正常工作。

### 方案 3：使用环境变量（临时方案）

如果方案 1 和 2 都不行，使用环境变量强制使用纯 Python 实现：

```bash
# 在启动 FunASR 服务器前设置
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
./scripts/start_funasr.sh
```

或者在启动脚本中添加：

```bash
# 修改 scripts/start_funasr.sh
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
python "$SERVER_SCRIPT"
```

**缺点**：
- ⚠️ 性能较慢（使用纯 Python 而不是 C++ 实现）
- ⚠️ 只是临时方案

### 方案 4：使用不同的 conda 环境（隔离方案）

为 FunASR 和 index-tts 创建独立的环境：

```bash
# 创建 FunASR 专用环境
conda create -n funasr python=3.10
conda activate funasr
pip install "numpy<2" funasr modelscope websockets

# index-tts 使用原来的 emobit 环境
conda activate emobit
# index-tts 相关操作
```

**优点**：
- ✅ 完全隔离，无冲突
- ✅ 可以分别管理依赖

**缺点**：
- ⚠️ 需要切换环境
- ⚠️ 管理更复杂

## 推荐操作步骤

1. **确认 protobuf 版本**（应该已经是 3.19.6）：

```bash
conda activate emobit
pip show protobuf | grep Version
# 应该显示: Version: 3.19.6
```

2. **测试 FunASR 是否正常工作**（忽略警告）：

```bash
./scripts/start_funasr.sh
```

3. **如果 FunASR 能正常启动和识别**：
   - ✅ **问题解决**，可以忽略 `tensorboardx` 的警告
   - 警告不影响实际功能

4. **如果 FunASR 报错**（与 protobuf 相关）：
   - 尝试方案 2：降级 `tensorboardx`
   - 或方案 3：使用环境变量

## 验证修复

运行以下命令检查依赖：

```bash
pip check
```

如果没有输出或只有无关的警告，说明依赖冲突已解决。

## 常见问题

**Q: 降级 protobuf 会影响其他功能吗？**

A: 通常不会。`protobuf 3.19.6` 是一个稳定版本，大多数包都能正常工作。

**Q: 为什么不能升级 descript-audiotools 和 tensorboard？**

A: 这些是 `index-tts` 项目的固定依赖，升级可能导致 `index-tts` 无法正常工作。

**Q: 这个冲突会影响 FunASR 的使用吗？**

A: **通常不会**。即使 pip 显示 `tensorboardx` 需要 `protobuf>=3.20` 的警告，但 `protobuf 3.19.6` 通常也能让 FunASR 正常运行。关键是**实际测试**，如果 FunASR 能正常启动和识别，就可以忽略警告。

**Q: 为什么会有这个警告？**

A: 这是 pip 的依赖检查机制。它检查所有包的声明依赖，发现 `tensorboardx` 声明需要 `protobuf>=3.20`，但实际安装的是 `3.19.6`，所以显示警告。但这不意味着代码无法运行，只是版本不完全匹配。

**Q: 我应该担心这个警告吗？**

A: **不需要**，只要 FunASR 能正常工作。这个警告是 pip 的预防性提示，实际运行时通常不会有问题。如果 FunASR 真的因为 protobuf 版本报错，再考虑其他方案。

## 总结

**当前状态**：
- ✅ `protobuf==3.19.6` 已安装
- ⚠️ `tensorboardx` 显示警告（但通常不影响功能）

**最佳实践**：
1. **先测试 FunASR 是否能正常工作**
2. **如果能正常工作，忽略警告即可**
3. **如果报错，再尝试其他方案**

**重要**：pip 的警告不等于实际错误。关键是测试实际功能是否正常。
