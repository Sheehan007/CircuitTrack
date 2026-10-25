import { useEffect } from 'preact/hooks';
import { store, useApp } from '../../app/store';
import * as A from '../../app/actions';
import { getEngine } from '../../app/host';
import { LESSONS } from '../../content/lessons';
import { Icon } from '../common';

/** Tiny inline markup for lesson text: **bold** and *italic*. */
export function Rich({ text }: { text: string }) {
  const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function LessonPanel() {
  const lessonId = useApp((s) => s.lessonId);
  const step = useApp((s) => s.lessonStep);
  const progress = useApp((s) => s.progress);
  const snap = useApp((s) => s.snap);
  const values = useApp((s) => s.lessonValues);
  const startValues = useApp((s) => s.stepStartValues);
  const lesson = A.currentLesson();
  const done = progress.lessons[lesson.id]?.done ?? [];
  const cur = lesson.steps[step];

  // live step checks: read the simulation and tick the step off when the learner has done it
  useEffect(() => {
    if (!snap || done.includes(step)) return;
    if (!cur.check) return;
    if (cur.check({ snap, values, history: getEngine().history, startValues })) A.markStepDone(step);
  }, [snap, step, values]);

  const canNext = !cur.check || done.includes(step);
  const next = () => { if (!cur.check) A.markStepDone(step); A.gotoStep(step + 1); };

  return (
    <div class="lesson-panel">
      <nav aria-label="Lessons">
        <h3>Lessons</h3>
        <ol class="lesson-list">
          {LESSONS.map((l) => {
            const pr = progress.lessons[l.id];
            const n = pr?.done.length ?? 0;
            return (
              <li key={l.id}>
                <button class={`lesson-card${l.id === lessonId ? ' on' : ''}`} aria-current={l.id === lessonId} onClick={() => A.openLesson(l.id)}>
                  <span class="num">{l.number}</span>
                  <span class="meta"><strong>{l.title}</strong><small>{l.summary}</small></span>
                  <span class="prog" aria-label={`${n} of ${l.steps.length} steps done`}>{pr?.completed ? <Icon name="check" size={16} /> : `${n}/${l.steps.length}`}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p class="fineprint">More lessons (knob and ADC, PWM fading, OLED, sensors) build on these two.</p>
      </nav>

      <section class="steps" aria-label={`${lesson.title}: steps`}>
        <h3>{lesson.number}. {lesson.title} <small>~{lesson.minutes} min</small></h3>
        <ol class="step-dots" aria-hidden="true">
          {lesson.steps.map((_, i) => <li key={i} class={`${i === step ? 'cur ' : ''}${done.includes(i) ? 'done' : ''}`} />)}
        </ol>
        <article class={`step${done.includes(step) ? ' done' : ''}`} aria-live="polite">
          <h4>Step {step + 1} of {lesson.steps.length}: {cur.title} {done.includes(step) && <span class="ok"><Icon name="check" size={14} /> done</span>}</h4>
          <p><Rich text={cur.body} /></p>
          {cur.hint && !done.includes(step) && <p class="hint">Hint: {cur.hint}</p>}
        </article>
        <div class="row">
          <button class="btn" disabled={step === 0} onClick={() => A.gotoStep(step - 1)}>Back</button>
          {step < lesson.steps.length - 1
            ? <button class={`btn primary${canNext ? '' : ' waiting'}`} onClick={next} title={canNext ? '' : 'Do the step first, or skip ahead'}>{canNext ? 'Next' : 'Skip'} <Icon name="chevron" size={14} /></button>
            : <button class="btn primary" onClick={() => { A.markStepDone(step); A.openLessonInBuild(); }}>Open in Build <Icon name="chevron" size={14} /></button>}
        </div>
        {step < lesson.steps.length - 1 && <button class="link small" onClick={A.openLessonInBuild}>Open this circuit in Build</button>}
      </section>
    </div>
  );
}

export function LessonOverview() {
  const lesson = A.currentLesson();
  return (
    <div class="overview">
      <h2>{lesson.title}</h2>
      <p class="summary">{lesson.summary}</p>
      <h3>How it works</h3>
      <ul>{lesson.overview.map((o) => <li key={o}>{o}</li>)}</ul>
      <h3>Parts</h3>
      <ul>{lesson.parts.map((p) => <li key={p}>{p}</li>)}</ul>
      <p class="fineprint">Click a part on the bench to inspect it. The simulator models the circuit electrically and runs a behaviour equivalent to the code; it does not execute firmware.</p>
      <button class="btn" onClick={() => store.set({ rightTab: 'code' })}>See the code</button>
    </div>
  );
}
