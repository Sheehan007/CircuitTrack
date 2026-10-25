import { render } from 'preact';
import './styles.css';
import { initStore } from './app/store';
import { createEngine } from './app/host';
import * as A from './app/actions';
import { LESSONS } from './content/lessons';
import './content/sketches';
import './content/examples';
import { App } from './ui/App';
import { startAudioSync } from './app/audio';

// Start where the URL points (#learn/<lesson> or #build); default to the first lesson.
const lessonMatch = location.hash.match(/^#learn\/(\w+)/);
const first = LESSONS.find((l) => l.id === lessonMatch?.[1]) ?? LESSONS[0];
const values = { ...first.defaults };
const project = first.build(values);

initStore({
  mode: 'learn',
  project,
  saved: false,
  lessonId: first.id,
  lessonValues: values,
  lessonStep: 0,
  stepStartValues: values,
  run: 'idle',
  speed: 1,
  selection: null,
  wireColor: '#f2b632',
  rightTab: 'overview',
  bottomTab: 'serial',
  centerTab: 'build',
  compile: { status: 'none', diagnostics: [], source: '' },
  snap: null,
  toast: null,
  canUndo: false,
  canRedo: false,
  fitToken: 0,
});
createEngine(project);
if (location.hash === '#build') A.setMode('build');
else A.openLesson(first.id);

startAudioSync();
render(<App />, document.getElementById('app')!);
