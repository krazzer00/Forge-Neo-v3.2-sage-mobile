#!/usr/bin/env python
# -*- coding: utf-8 -*-

# Rewritten for Forge-Neo / Python 3.13.
#
# The original install.py pulled in langchain<0.3 (which forces numpy<2 and would
# downgrade/break torch), llama-cpp-python from cp310-only wheels, and openai==0.28.
# None of that installs or works on this build, so nothing is force-installed here
# any more. The extension now talks to OpenAI-compatible endpoints and to Ollama
# directly, using packages the WebUI already ships.

import launch

for package, module in (("openai", "openai"), ("requests", "requests")):
    if not launch.is_installed(module):
        launch.run_pip(f"install {package}", f"sd-webui-chatgpt requirement: {package}")
