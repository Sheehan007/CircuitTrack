import { useMemo, useState } from 'preact/hooks';
import { catalogue } from '../../sim/components/registry';
import { DRAWERS } from '../../figures';
import { partThumbnail } from '../../figures/scene';
import * as A from '../../app/actions';

const ORDER = ['Outputs', 'Inputs', 'Passives', 'Sensors', 'Displays', 'Actuators', 'Prototyping'];

export function Catalogue() {
  const [q, setQ] = useState('');
  // only parts with a working model *and* a drawing are offered
  const defs = useMemo(() => catalogue().filter((d) => DRAWERS[d.type]), []);
  const thumbs = useMemo(() => Object.fromEntries(defs.map((d) => [d.type, partThumbnail(d.type)])), [defs]);
  const shown = defs.filter((d) => !q || `${d.name} ${d.summary} ${d.category}`.toLowerCase().includes(q.toLowerCase()));
  const groups = ORDER.map((c) => [c, shown.filter((d) => d.category === c)] as const).filter(([, l]) => l.length);
  return (
    <div class="catalogue">
      <label class="search">
        <span class="sr-only">Search parts</span>
        <input type="search" placeholder="Search parts…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </label>
      {groups.map(([cat, list]) => (
        <section key={cat}>
          <h3>{cat}</h3>
          <ul>
            {list.map((d) => (
              <li key={d.type}>
                <div
                  class="part-card"
                  draggable
                  onDragStart={(e) => { e.dataTransfer!.setData('text/x-esp32lab-part', d.type); e.dataTransfer!.effectAllowed = 'copy'; }}
                  title="Drag onto the bench, or press Add"
                >
                  <div class="thumb" dangerouslySetInnerHTML={{ __html: thumbs[d.type] }} />
                  <div class="meta">
                    <strong>{d.name}</strong>
                    <span>{d.summary}</span>
                  </div>
                  <button class="add" onClick={() => A.addPart(d.type)} aria-label={`Add ${d.name} to the bench`}>Add</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p class="fineprint">Every part listed here has a working electrical model and behaviour. New parts only appear once theirs is done.</p>
    </div>
  );
}
