import sys
import importlib.metadata
import importlib.util
import platform
import psutil  # pip install psutil
import torch
import socket
import urllib.request
import json

print("Список установленных пакетов:\n")

# Список всех пакетов
installed_packages = sorted(
    [(dist.metadata["Name"], dist.version) for dist in importlib.metadata.distributions()]
)

for name, version in installed_packages:
    print(f"{name}=={version}")

# Разделитель
print("\n" + "="*50 + "\n")

# Версии ключевых компонентов
print("Версии основных компонентов:\n")

# Python
print(f"Python: {sys.version.split()[0]}")

# PyTorch
try:
    import torch
    print(f"PyTorch: {torch.__version__}")
    print(f"CUDA build: {torch.version.cuda}")
except ImportError:
    print("PyTorch: не установлен")

# Triton
try:
    import triton
    print(f"Triton: {triton.__version__}")
except ImportError:
    print("Triton: не установлен")

# SageAttention (без __version__)
try:
    import sageattention
    try:
        version = importlib.metadata.version("sageattention")
    except importlib.metadata.PackageNotFoundError:
        version = "неизвестно"
    print(f"SageAttention: {version}")
except ImportError:
    print("SageAttention: не установлен")

# Разделитель
print("\n" + "="*50 + "\n")

# Информация о системе
print("Информация о системе:\n")

# RAM
ram_gb = psutil.virtual_memory().total / (1024 ** 3)
print(f"Объем RAM: {ram_gb:.2f} GB")

# OS
os_info = f"{platform.system()} {platform.release()} ({platform.version()})"
print(f"ОС: {os_info}")

# GPU
if torch.cuda.is_available():
    gpu_count = torch.cuda.device_count()
    print(f"Количество GPU: {gpu_count}")
    for i in range(gpu_count):
        print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
else:
    print("GPU: не обнаружено")

# Разделитель
print("\n" + "="*50 + "\n")

# IP-адреса
print("Сетевые адреса:\n")

# Внутренний IP
try:
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    print(f"Внутренний IP: {local_ip}")
except Exception as e:
    print(f"Внутренний IP: не удалось получить ({e})")

# Внешний IP
try:
    with urllib.request.urlopen("https://api.ipify.org?format=json") as response:
        data = json.load(response)
        external_ip = data.get("ip", "неизвестно")
    print(f"Внешний IP: {external_ip}")
except Exception as e:
    print(f"Внешний IP: не удалось получить ({e})")
