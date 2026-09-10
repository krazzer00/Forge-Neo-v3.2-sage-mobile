/* ==========================================================================
   t2i.js — вкладка txt2img
   ========================================================================== */
import { h } from './core.js';
import { S, saveParams } from './state.js';
import {
  promptBlock, coreBlock, hiresBlock, extensionsBlock, scriptBlock,
  resultBlock, txt2imgPayload, runGeneration, pushHistory,
} from './gen.js';
import { PresetBlock } from './presets.js';
import { ReferenceBlock } from './characters.js';

let ui = null;

export function mount(root) {
  if (ui) return ui;
  const params = S.t2i;
  const prompt = promptBlock(params, 't2i');
  const core = coreBlock(params, 't2i');
  const hires = hiresBlock(params, 't2i');
  const result = resultBlock('txt2img');

  const refresh = () => { core.refresh(); prompt.refreshPrompt(); hires.refresh(); };

  root.textContent = '';
  root.append(
    result.el,
    prompt,
    ReferenceBlock(),
    PresetBlock('txt2img', params, refresh),
    core.el,
    hires.el,
    scriptBlock('txt2img', params),
    extensionsBlock('txt2img'),
  );

  ui = {
    params, result, refresh,
    async run() {
      pushHistory(params);
      saveParams('t2i', params);
      await runGeneration({
        endpoint: '/sdapi/v1/txt2img',
        payload: txt2imgPayload(params),
        result, mode: 'txt2img',
      });
    },
  };
  return ui;
}

export function get() { return ui; }
