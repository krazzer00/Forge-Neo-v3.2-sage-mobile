import launch

# rembg: Python 3.13 compatible
if not launch.is_installed("rembg"):
    launch.run_pip(
        "install rembg==2.0.72 --prefer-binary",
        "rembg"
    )

# Explicit deps for Python 3.13 + CUDA
deps = {
    "onnxruntime-gpu": "onnxruntime-gpu>=1.18.0",
    "pymatting": "pymatting>=1.1.12",
    "pooch": "pooch>=1.8.2",
}

for name, pkg in deps.items():
    if not launch.is_installed(name):
        launch.run_pip(
            f"install {pkg} --prefer-binary",
            f"{name} for REMBG extension"
        )

