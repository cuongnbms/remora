let counter = 0;

export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre.mermaid-block')];
  if (!blocks.length) return;
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true });
  for (const el of blocks) {
    const code = el.dataset.mermaid ?? '';
    try {
      const { svg } = await mermaid.render(`remora-mermaid-${counter++}`, code);
      const div = document.createElement('div');
      div.className = 'mermaid-svg';
      div.innerHTML = svg;
      el.replaceWith(div);
    } catch (e) {
      el.classList.remove('mermaid-block');
      el.classList.add('mermaid-error');
      el.textContent = code;
      const msg = document.createElement('div');
      msg.className = 'mermaid-error-msg';
      msg.textContent = `Mermaid error: ${e instanceof Error ? e.message : String(e)}`;
      el.before(msg);
    }
  }
}
