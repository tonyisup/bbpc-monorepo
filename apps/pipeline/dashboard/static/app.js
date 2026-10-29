// BBPC pipeline dashboard. Every figure is computed by the server (dashboard/views.py);
// this file lays it out. Looking only sends GET requests. The Lab, its drafts, the Clips,
// Shirts and Runs tabs send POSTs, each carrying the token the server made when it started.
'use strict';

const view = document.getElementById('view');
let token = '';

// Build an element. Text always goes in as text nodes, never as HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'onclick') el.addEventListener('click', value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function api(path) {
  const response = await fetch(path, {cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${path} answered ${response.status}`);
  return body;
}

// Returns {ok, status, body}: a refused request is an answer to show, not an exception.
async function post(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Dashboard-Token': token},
    body: JSON.stringify(payload),
  });
  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {error: `the server answered ${response.status}`};
  }
  return {ok: response.ok, status: response.status, body: body || {}};
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
const when = iso => (iso ? new Date(iso).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'never');
const megabytes = bytes => `${Math.round(bytes / 1e6)} MB`;
const dot = tone => h('i', {class: `dot ${tone}`});
const pill = (tone, text) => h('span', {class: 'pill'}, dot(tone), text);
const tag = text => h('span', {class: 'tag'}, text);
const episodeName = ep => (ep.number ? `Ep ${ep.number}` : ep.date || ep.stem);

// --------------------------------------------------------------------------- stages

const STAGE_LABELS = {import_transcript: 'import', review_clip: 'review clips'};
const STATE_WORDS = {
  done: 'file found', partial: 'some files found', missing: 'no file', waiting: 'waiting on Cowork',
  recorded: 'finished, by the stage journal', failed: 'last run failed, by the stage journal',
  inferred: 'inferred from state.json, not checked', unknown: 'no way to tell from local files',
};
const STATE_MARKS = {done: '✓', partial: '◐', missing: '–', waiting: '…', recorded: '✓', failed: '✗', inferred: '✓', unknown: '?'};
const stageLabel = stage => STAGE_LABELS[stage] || stage;
const stageTitle = row => `${stageLabel(row.stage)}: ${STATE_WORDS[row.state]}. ${row.detail}`;

function rail(stages) {
  return h('span', {class: 'rail'}, stages.map(row => h('i', {class: row.state, title: stageTitle(row)})));
}

function stageLegend() {
  const key = (state, text) => h('span', {}, h('span', {class: 'rail'}, h('i', {class: state})), text);
  return h('div', {class: 'legend mut sm'},
    key('done', 'file found'), key('partial', 'some files'), key('waiting', 'waiting on Cowork'),
    key('missing', 'no file'), key('recorded', 'finished, by the stage journal'), key('failed', 'last run failed'),
    key('inferred', 'inferred from state.json, not checked'), key('unknown', 'cannot tell'));
}

// --------------------------------------------------------------------------- Today

function coworkSummary(files) {
  const words = {ok: 'OK', invalid: 'has problems', missing: 'not written', not_written: 'not written (optional)'};
  return files.map(file => `${file.label}: ${words[file.status]}`).join(' · ');
}

function needRow(need) {
  if (need.kind === 'clips') {
    return h('div', {}, dot('wa'), h('div', {class: 't'},
      h('b', {}, `${episodeName(need)} · ${plural(need.count, 'rendered clip has', 'rendered clips have')} no publish decision`),
      h('div', {class: 'mut sm'}, need.title ? `${need.title} · ` : '', 'Watch them and mark each one published or skipped.')),
      h('a', {class: 'btn p', href: `#clips/${need.stem}`}, 'Review clips'));
  }
  if (need.kind === 'cowork') {
    const ready = need.ready && need.ok;
    return h('div', {}, dot(ready ? 'in' : 'wa'), h('div', {class: 't'},
      h('b', {}, `${episodeName(need)} · ${ready ? "Cowork's files are ready" : 'waiting on Cowork'}`),
      h('div', {class: 'mut sm'}, coworkSummary(need.files)),
      ready && h('div', {class: 'mut sm'}, 'Resume on the Runs tab, or with ',
        h('code', {}, `python pipeline.py episodes/${need.stem}.mp3 --from movies`)),
      !ready && need.headless && h('div', {class: 'mut sm'},
        'Headless Cowork is on, so its session failed or was skipped. Run the pipeline again to retry it, or write the files in Cowork.'),
      need.lastError && h('pre', {}, `Last error: ${need.lastError}`)),
      ready && h('a', {class: 'btn p', href: `#runs/resume/${need.stem}`}, 'Resume…'),
      h('a', {class: 'btn', href: `#episode/${need.stem}`}, 'Open episode'));
  }
  if (need.kind === 'phrases') {
    return h('div', {}, dot('wa'), h('div', {class: 't'},
      h('b', {}, 'Phrase report is older than the ignore list'),
      h('div', {class: 'mut sm'}, `Report saved ${when(need.reportSavedAt)}, ignore.txt saved ${when(need.ignoreSavedAt)}. `,
        'Rescan (about 20 s) on the Shirts tab, or with ', h('code', {}, 'python3 scripts/scan_phrases.py'))),
      h('a', {class: 'btn', href: '#shirts'}, 'Open Shirts'));
  }
  return h('div', {}, dot('in'), h('div', {class: 't'},
    h('b', {}, `${plural(need.episodes.length, 'transcript has', 'transcripts have')} no SEO file or state entry`),
    h('div', {class: 'mono mut wrap'}, need.episodes.map(ep =>
      h('a', {href: `#episode/${ep.stem}`, title: `No ${ep.missing.join(', no ')}`}, ep.stem)))));
}

function shortsText(shorts) {
  if (!shorts) return '—';
  const parts = [];
  if (shorts.published) parts.push(`${shorts.published} published`);
  if (shorts.skipped) parts.push(`${shorts.skipped} skipped`);
  if (shorts.toReview) parts.push(`${shorts.toReview} to review`);
  return parts.join(', ') || '—';
}

function statusPill(row) {
  if (row.status === 'waiting') return pill('wa', 'Waiting on Cowork');
  if (row.status === 'review') return pill('wa', `${plural(row.shorts.toReview, 'clip')} to review`);
  if (row.status === 'done') return pill('ok', 'Done');
  return pill('no', 'Not processed');
}

function renderToday(data) {
  const a = data.archive;
  const tile = (label, value, note) => h('div', {class: 'tile'},
    h('div', {class: 'mut sm'}, label), h('div', {class: 'v'}, value.toLocaleString()), h('div', {class: 'mut sm'}, note));
  return [
    h('h3', {}, 'Needs you'),
    h('div', {class: 'need'}, data.needs.length ? data.needs.map(needRow)
      : h('div', {}, dot('ok'), h('div', {class: 't'}, 'Nothing needs you.'))),
    h('h3', {}, 'Archive'),
    h('div', {class: 'tiles'},
      tile('Transcripts', a.transcripts, a.firstDate ? `${a.firstDate} to ${a.lastDate}` : 'none yet'),
      tile('Episodes done', a.done, `${a.waiting} waiting on Cowork`),
      tile('Shorts published', a.shortsPublished, `of ${plural(a.decisions, 'decision')} recorded`),
      tile('Recurring phrases', a.phrases, a.phrasesScanned ? `plus ${plural(a.passages, 'passage')}` : 'not scanned yet')),
    h('h3', {}, 'Recent episodes'),
    h('table', {},
      h('tr', {}, ['Ep', 'Title', 'Stages', 'Status', 'Shorts'].map(name => h('th', {}, name))),
      data.recent.map(row => h('tr', {class: 'link', onclick: () => { location.hash = `#episode/${row.stem}`; }},
        h('td', {class: 'mono'}, row.number || '—'),
        h('td', {}, row.title && h('b', {}, row.title), row.title && ' ',
          h('span', {class: 'mut sm'}, row.date || row.stem)),
        h('td', {}, rail(row.stages)),
        h('td', {}, statusPill(row)),
        h('td', {class: 'mut sm'}, shortsText(row.shorts))))),
    data.recent.length ? h('div', {class: 'mut sm gap'}, `Stage bars: ${data.recent[0].stages.map(s => stageLabel(s.stage)).join(', ')}.`) : null,
    stageLegend(),
  ];
}

// --------------------------------------------------------------------------- Episode

function coworkFile(file, state) {
  const name = file.path.split('/').pop();
  const done = state.status === 'done';
  const shown = {
    ok: ['ok', `OK · ${file.summary}`],
    invalid: ['er', `FAIL · ${plural(file.problems.length, 'problem')}`],
    missing: [done ? 'no' : 'wa', done ? 'not written (the episode is done without it)' : 'MISSING'],
    not_written: ['no', 'not written (optional)'],
  }[file.status];
  return [
    h('div', {class: 'file'}, dot(shown[0]), h('span', {class: 'mono'}, name), h('span', {class: 'sp'}),
      h('span', {class: 'mut sm'}, shown[1])),
    file.problems.length ? h('ul', {class: 'sm problem'}, file.problems.map(text => h('li', {}, text))) : null,
    file.warnings.length ? h('ul', {class: 'sm warning'}, file.warnings.map(text => h('li', {}, `warning: ${text}`))) : null,
  ];
}

function seoBox(ep) {
  const seo = ep.seo;
  if (!seo) return h('div', {class: 'box mut'}, 'No SEO file yet.');
  const over = seo.titleLength > seo.titleMax;
  const fill = h('i', {});
  fill.style.width = `${Math.min(100, Math.round(100 * seo.titleLength / seo.titleMax))}%`;
  return h('div', {class: 'box bar'},
    h('div', {class: 't sp'},
      seo.title ? h('b', {}, seo.title) : h('span', {class: 'problem'}, 'No title in this file'),
      h('div', {class: over ? 'sm warning' : 'sm mut'},
        `${seo.titleLength} of ${seo.titleMax} characters${over ? `: ${seo.titleLength - seo.titleMax} over` : ''}`),
      h('div', {class: over ? 'meter over' : 'meter'}, fill),
      h('div', {class: 'mut sm mono gap'}, seo.source)),
    ep.thumbnail && h('img', {class: 'thumb', src: ep.thumbnail, alt: 'Episode thumbnail', loading: 'lazy'}));
}

function moviesBox(movies) {
  if (!movies.source) return h('div', {class: 'box mut'}, 'No movies file yet.');
  const rated = movies.rows.some(row => movies.hosts.some(host => row.ratings[host]));
  const withId = movies.rows.filter(row => row.hasMovieId).length;
  const about = row => [
    row.reviewType && row.reviewType.replace('_', ' '),
    row.pickedBy && `${row.pickedBy}'s pick`,
    row.status !== 'accepted' && row.status,
  ].filter(Boolean).join(' · ');
  return h('div', {class: 'box'},
    movies.rows.length ? h('table', {},
      h('tr', {}, h('th', {}, 'Movie'), movies.hosts.map(host => h('th', {}, host))),
      movies.rows.map(row => h('tr', {},
        h('td', {}, h('b', {}, row.title || 'untitled'), row.year ? ` (${row.year})` : '',
          about(row) && h('div', {class: 'mut sm'}, about(row))),
        movies.hosts.map(host => h('td', {}, row.ratings[host] || ''))))) : h('div', {class: 'mut'}, 'No movies in this file.'),
    h('div', {class: 'mut sm gap'},
      movies.rows.length && !rated ? 'This file has no host ratings. ' : '',
      movies.rows.length ? `${withId} of ${movies.rows.length} have a Convex movie ID in the file. ` : ''),
    h('div', {class: 'mut sm mono'}, [movies.source, movies.extractor].filter(Boolean).join(' · ')));
}

function renderEpisode(ep, list) {
  const picker = h('select', {class: 'btn', 'aria-label': 'Episode'}, list.map(row =>
    h('option', {value: row.stem, selected: row.stem === ep.stem},
      [row.number, row.title, row.date || row.stem].filter(Boolean).join(' · '))));
  picker.addEventListener('change', () => { location.hash = `#episode/${picker.value}`; });
  const step = (stem, text) => h('a', {class: stem ? 'btn' : 'btn off', href: stem ? `#episode/${stem}` : null}, text);
  const state = ep.state;
  const named = [ep.number, ep.title].filter(Boolean).join(' · ');
  return [
    h('div', {class: 'bar'},
      h('b', {class: 'big'}, named || ep.date || ep.stem),
      h('span', {class: 'mut'}, [named && ep.date, ep.audio ? `${ep.audio.file} · ${megabytes(ep.audio.bytes)}` : 'no local mp3'].filter(Boolean).join(' · ')),
      h('span', {class: 'sp'}), step(ep.prev, '← Older'), picker, step(ep.next, 'Newer →'),
      ep.audio && h('a', {class: 'btn', href: `#runs/from/${ep.stem}`}, 'Run from a stage…')),
    ep.audio
      ? h('audio', {controls: true, preload: 'none', src: ep.audio.url})
      : h('div', {class: 'mut sm gap'}, `No local mp3 for this episode, so there is nothing to play. ${plural(ep.audioEpisodes, 'episode has', 'episodes have')} one.`),
    h('h3', {}, 'Stages'),
    h('div', {class: 'stages'}, ep.stages.map(row => h('div', {class: `stage ${row.state}`, title: stageTitle(row)},
      h('b', {}, STATE_MARKS[row.state]), stageLabel(row.stage),
      h('span', {class: 'd'}, row.checked ? row.detail : `${row.state}: no local file`)))),
    h('div', {class: 'mut sm gap'},
      'Import and publish leave no local file. Their last run in the stage journal decides; with none, they are read from state.json (dashed and dotted): ',
      state.status ? h('b', {}, state.status) : h('b', {}, 'no entry'),
      state.updatedAt ? `, updated ${when(state.updatedAt)}` : '', state.note ? ` (${state.note})` : '', '.'),
    state.lastError && h('pre', {}, `Last error: ${state.lastError}`),
    h('div', {class: 'two'},
      h('div', {},
        h('h3', {}, 'Cowork files'),
        h('div', {class: 'box'}, ep.cowork.files.map(file => coworkFile(file, state)),
          !ep.cowork.transcriptFound && h('div', {class: 'mut sm gap'}, ep.cowork.transcriptNote
            ? `The transcript ${ep.cowork.transcriptNote}, so the duration, segment-boundary and phrase-text checks were skipped.`
            : 'Transcript not found, so the duration, segment-boundary and phrase-text checks were skipped.')),
        h('h3', {}, 'SEO title'),
        seoBox(ep)),
      h('div', {}, h('h3', {}, 'Movies'), moviesBox(ep.movies))),
  ];
}

// --------------------------------------------------------------------------- drafts (shared by Settings and Lab)

// The draft being edited is remembered per browser; the server keeps the drafts themselves.
const DRAFT_KEY = 'bbpc.lab.draft';
const chosenDraftName = () => localStorage.getItem(DRAFT_KEY) || '';
const chooseDraft = name => (name ? localStorage.setItem(DRAFT_KEY, name) : localStorage.removeItem(DRAFT_KEY));
const chosenDraft = drafts => drafts.find(draft => draft.name === chosenDraftName()) || null;

function shown(value) {
  if (value === null || value === undefined) return 'unset';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const changeLine = change => `${change.key}: ${shown(change.from)} → ${shown(change.to)}`;

async function saveDraft(draft, overrides) {
  return post('/api/lab/drafts', {name: draft.name, title: draft.title, overrides});
}

async function newDraft() {
  const title = (window.prompt('Name the draft (for example "bigger captions"):') || '').trim();
  if (!title) return;
  const answer = await post('/api/lab/drafts', {title, overrides: {}});
  if (!answer.ok) {
    window.alert(answer.body.error);
    return;
  }
  chooseDraft(answer.body.draft.name);
  route();
}

function draftPicker(drafts) {
  const picker = h('select', {class: 'inp', 'aria-label': 'Draft'},
    h('option', {value: ''}, 'No draft: config.json as it is'),
    drafts.map(draft => h('option', {value: draft.name, selected: draft.name === chosenDraftName()},
      `${draft.title} (${plural(draft.changes.length, 'change')})`)));
  picker.addEventListener('change', () => { chooseDraft(picker.value); route(); });
  return picker;
}

// --------------------------------------------------------------------------- Settings

let applied = null; // the answer to the last "Apply to config.json", shown until the tab is left

// An input for one draftable setting. `onSet` receives the parsed value.
function settingInput(row, value, changed, onSet) {
  const cls = `inp${changed ? ' ch' : ''}`;
  let input;
  if (row.type === 'bool' || row.type === 'choice') {
    const options = row.type === 'bool' ? [true, false] : row.choices;
    input = h('select', {class: cls}, options.map(option =>
      h('option', {value: String(option), selected: option === value}, String(option))));
    input.addEventListener('change', () => onSet(row.type === 'bool' ? input.value === 'true' : input.value));
  } else if (row.type === 'int' || row.type === 'float') {
    input = h('input', {class: cls, type: 'number', value, min: row.minimum, max: row.maximum,
      step: row.type === 'int' ? 1 : 'any'});
    input.addEventListener('change', () => { if (input.value !== '') onSet(Number(input.value)); });
  } else if (row.type === 'text') {
    input = h('textarea', {class: cls, rows: 5}, value);
    input.addEventListener('change', () => onSet(input.value));
  } else {
    input = h('input', {class: cls, type: 'text', value});
    input.addEventListener('change', () => onSet(input.value));
  }
  input.setAttribute('aria-label', row.key);
  return input;
}

function settingRow(row, draft) {
  const from = row.source === 'config' ? 'config.json' : row.source === 'default' ? 'code default' : `from ${row.source}`;
  const differs = row.source !== 'default' && shown(row.value) !== shown(row.default);
  const long = row.type === 'text';
  const editable = draft && row.draft;
  const drafted = editable && Object.prototype.hasOwnProperty.call(draft.overrides, row.key);
  const problems = h('div', {class: 'sm problem'}, row.problems.join(' '));

  let valueCell;
  if (editable) {
    const set = async value => {
      const overrides = {...draft.overrides, [row.key]: value};
      const answer = await saveDraft(draft, overrides);
      if (answer.ok) route();
      else problems.textContent = (answer.body.problems || [answer.body.error]).join(' ');
    };
    const reset = async () => {
      const overrides = {...draft.overrides};
      delete overrides[row.key];
      await saveDraft(draft, overrides);
      route();
    };
    valueCell = h('td', {},
      drafted && !long && h('span', {class: 'was'}, shown(row.value)),
      settingInput(row, drafted ? draft.overrides[row.key] : row.value, drafted, set),
      drafted && h('div', {class: 'gap'}, h('button', {class: 'btn s', onclick: reset}, 'Back to config.json')),
      problems);
  } else {
    valueCell = h('td', {}, h('span', {class: `val${differs ? ' ch' : ''}${long ? ' text' : ''}`}, shown(row.value)), problems);
  }
  return h('tr', {},
    h('td', {class: 'k'}, h('b', {class: 'mono'}, row.key), h('div', {class: 'mut sm'}, row.description),
      (row.choices.length || row.minimum !== null) && h('div', {class: 'mut sm'},
        row.choices.length ? `One of: ${row.choices.join(', ')}` : `${row.minimum} to ${row.maximum}`)),
    valueCell,
    h('td', {class: 'mut wrap'}, long && shown(row.value) === shown(row.default) ? 'same' : shown(row.default)),
    h('td', {class: 'right'}, drafted ? tag('draft') : tag(from),
      h('div', {class: 'mut sm'}, row.stages.length ? row.stages.map(stageLabel).join(', ') : 'nothing reads it'),
      draft && !row.draft && h('div', {class: 'mut sm'}, 'not in drafts')));
}

function configCheck(check) {
  const keys = list => h('div', {class: 'mono mut wrap'}, list.join(' · '));
  const lines = [];
  if (check.notInConfig.length) {
    lines.push(h('li', {}, h('details', {},
      h('summary', {}, `${plural(check.notInConfig.length, 'setting')} the code reads ${check.notInConfig.length === 1 ? 'is' : 'are'} not in config.json, so ${check.notInConfig.length === 1 ? 'it uses its default' : 'they use their defaults'}`),
      keys(check.notInConfig))));
  }
  for (const key of check.unread) lines.push(h('li', {}, h('span', {class: 'mono'}, key), ' is set but nothing reads it'));
  for (const key of check.undeclared) lines.push(h('li', {class: 'warning'}, h('span', {class: 'mono'}, key), ' is set but is not a known setting'));
  for (const row of check.invalid) lines.push(h('li', {class: 'problem'}, row.problems.join('; ')));
  return h('div', {class: 'box gap'}, h('b', {}, 'Config check'),
    lines.length ? h('ul', {}, lines) : h('div', {class: 'mut sm'}, 'config.json matches what the code reads.'));
}

async function applyDraft(draft) {
  const question = `Apply "${draft.title}" to config.json?\n\n${draft.changes.map(changeLine).join('\n')}\n\n`
    + 'Real runs will use these values from now on. config.json is tracked in git; this does not commit it.';
  if (!window.confirm(question)) return;
  const answer = await post('/api/lab/drafts/apply', {name: draft.name});
  if (!answer.ok) {
    window.alert((answer.body.problems || [answer.body.error]).join('\n'));
    return;
  }
  applied = {title: draft.title, ...answer.body};
  chooseDraft('');
  route();
}

async function discardDraft(draft) {
  if (!window.confirm(`Discard the draft "${draft.title}"? Past Lab runs keep their own copy of its values.`)) return;
  await post('/api/lab/drafts/delete', {name: draft.name});
  chooseDraft('');
  route();
}

function draftBar(drafts) {
  const draft = chosenDraft(drafts);
  const extra = [h('span', {class: 'sp'}), drafts.length > 0 && draftPicker(drafts), h('button', {class: 'btn', onclick: newDraft}, 'New draft')];
  if (!draft) {
    return h('div', {class: 'draftbar'}, dot('no'), h('b', {}, 'No draft'),
      h('span', {class: 'mut'}, 'Settings are changed in a draft and tried in the Lab. Real runs keep using config.json until you apply one.'),
      extra);
  }
  const invalid = draft.problems.length > 0;
  return h('div', {class: 'draftbar'}, dot(invalid ? 'er' : 'wa'), h('b', {}, `Draft "${draft.title}"`),
    h('span', {class: invalid ? 'problem' : 'mut'}, invalid ? draft.problems.join(' ')
      : `${plural(draft.changes.length, 'change')}, not applied. Real runs still use config.json.`),
    extra,
    h('a', {class: 'btn', href: '#lab'}, 'Try in Lab'),
    h('button', {class: 'btn p', disabled: invalid || !draft.changes.length, onclick: () => applyDraft(draft)}, 'Apply to config.json…'),
    h('button', {class: 'btn', onclick: () => discardDraft(draft)}, 'Discard'));
}

function renderSettings(data) {
  const draft = chosenDraft(data.drafts);
  const anchor = name => `group-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const jump = name => () => document.getElementById(anchor(name)).scrollIntoView({behavior: 'smooth'});
  const extras = {
    Prompts: () => [
      h('div', {class: 'box gap'},
        h('div', {class: 'bar'}, h('b', {}, 'Abstract-visual guardrail'), h('span', {class: 'sp'}), tag('in code, always appended')),
        h('div', {class: 'sm gap'}, data.guardrail),
        h('div', {class: 'bar gap'}, h('b', {}, 'Image prompt per clip'), h('span', {class: 'sp'}), tag('written by Cowork')),
        h('div', {class: 'mut sm'}, "Each clip's imagePrompt is in the episode's SEO file. The image model receives the prompt, then the style suffix, then the guardrail. Try a different prompt on one clip in the Lab; the SEO file is not edited.")),
    ],
    'Cowork instructions': () => [
      h('div', {class: 'box gap'},
        h('div', {class: 'bar'}, h('b', {}, 'What Cowork reads'), h('span', {class: 'sp'}), tag('files in git')),
        h('div', {class: 'mono gap'}, data.docs.map((doc, i) => [i ? ' · ' : '',
          h('a', {href: doc.url, target: '_blank', rel: 'noopener'}, doc.name)])),
        h('div', {class: 'mut sm'}, 'They change what Cowork writes for the next episode, so they cannot be tried in the Lab. Edit them in the repository.')),
    ],
  };
  return [
    draftBar(data.drafts),
    applied && h('div', {class: 'box gap'},
      h('b', {}, `Applied "${applied.title}" to config.json.`), ' Nothing was committed: ',
      h('code', {}, 'git diff -- config.json'), ' now shows',
      h('pre', {}, applied.gitDiff || applied.diff || 'no difference')),
    h('div', {class: 'set gap'},
      h('div', {class: 'nav sm'},
        data.groups.map(group => h('a', {href: '#settings', onclick: event => { event.preventDefault(); jump(group.name)(); }}, group.name)),
        configCheck(data.check)),
      h('div', {}, data.groups.map(group => [
        h('h3', {id: anchor(group.name)}, group.name),
        group.settings.length ? h('table', {class: 'cols'},
          h('tr', {}, ['Setting', 'Value', 'Default', ''].map(name => h('th', {}, name))),
          group.settings.map(row => settingRow(row, draft))) : null,
        extras[group.name] ? extras[group.name]() : null,
      ]))),
  ];
}

// --------------------------------------------------------------------------- Lab

// What the form holds, kept across re-renders and polls.
// `background` is the still to reuse: 'real', or the id of the Lab run that made it.
const labForm = {stem: null, clip: null, start: null, end: null, prompt: null, background: null, shownRun: null, error: null};
let labPoll = null;

const seconds = clip => Math.round(clip.end - clip.start);
const clipLabel = clip => (clip.source === 'pick'
  ? `${String(clip.index).padStart(2, '0')} · ${clip.headline} · ${seconds(clip)} s`
  : `c${clip.index} · ${clip.headline} · ${seconds(clip)} s · ${clip.labBackgrounds.length ? 'Lab background' : 'no still'}`);
// The stills a render can reuse: the real one, then those Lab runs made for the clip, newest first.
const backgrounds = clip => [
  ...(clip.hasStill ? [{id: 'real', label: 'The real still', url: clip.stillUrl}] : []),
  ...clip.labBackgrounds.map(made => ({
    id: made.run, label: `Made in the Lab · ${when(made.createdAt)}`, url: made.url, prompt: made.imagePrompt})),
];
// The provider a new background would use: the chosen draft's when it has one, else config.json's.
const labProvider = (data, draft) => (draft && draft.provider) || data.provider;
const RUN_WORDS = {ready: 'starting', running: 'rendering', done: 'done', failed: 'failed', interrupted: 'interrupted'};
const RUN_TONES = {ready: 'in', running: 'in', done: 'ok', failed: 'er', interrupted: 'wa'};

async function render(data, clip, draft, newBackground, background) {
  const edits = {};
  if (labForm.start !== null && labForm.start !== clip.start) edits.start = labForm.start;
  if (labForm.end !== null && labForm.end !== clip.end) edits.end = labForm.end;
  if (newBackground && labForm.prompt !== null && labForm.prompt !== clip.imagePrompt) edits.imagePrompt = labForm.prompt;
  const provider = labProvider(data, draft);
  if (newBackground && provider.paid && !window.confirm(
    `This makes ONE PAID image request to ${provider.name} (${provider.model}).\n\nContinue?`)) return;
  const request = confirmPaid => post('/api/lab/runs', {
    stem: labForm.stem, clip: clip.id, stage: 'clip', draft: draft ? draft.name : null, edits,
    newBackground, confirmPaid, background: !newBackground && background && background.id !== 'real' ? background.id : null,
  });
  let answer = await request(newBackground && provider.paid);
  // The server decides what is paid; if it still asks (config.json changed since the page loaded), ask Tony too.
  if (!answer.ok && answer.body.code === 'confirm_paid') {
    if (!window.confirm(`${answer.body.error}\n\nContinue?`)) return;
    answer = await request(true);
  }
  labForm.error = answer.ok ? null : (answer.body.problems || [answer.body.error]).join(' ');
  if (answer.ok) location.hash = `#lab/${answer.body.run.id}`; // the run has its own address
  else route();
}

async function deleteRun(run) {
  if (!window.confirm(`Delete this test render? Only its folder under output/lab/ is removed.\n\n${run.id}`)) return;
  const answer = await post('/api/lab/runs/delete', {id: run.id});
  if (!answer.ok) window.alert(answer.body.error);
  if (labForm.shownRun === run.id) {
    labForm.shownRun = null;
    if (location.hash !== '#lab') {
      location.hash = '#lab';
      return;
    }
  }
  route();
}

function runSummary(run) {
  const changes = Object.entries(run.overrides).map(([key, value]) => `${key} = ${shown(value)}`);
  const edits = Object.entries(run.edits).map(([key, value]) => `${key} = ${shown(value)}`);
  return [
    run.draft ? `draft "${run.draft.title}"` : 'config.json as it was',
    changes.length ? changes.join(', ') : null,
    edits.length ? `clip edits: ${edits.join(', ')}` : null,
    run.newBackground ? `new background (${run.provider}${run.paid ? ', paid' : ''})`
      : run.background ? 'reused a Lab background' : 'reused still',
  ].filter(Boolean).join(' · ');
}

// --------------------------------------------------------------------------- Lab: publishing to YouTube

const UPLOAD_WORDS = {ready: 'starting upload', uploading: 'uploading', done: 'on YouTube, private', failed: 'upload failed',
  interrupted: 'upload interrupted'};
const UPLOAD_TONES = {ready: 'in', uploading: 'in', done: 'ok', failed: 'er', interrupted: 'wa'};
// What the upload form holds for the run on show, kept across re-renders.
const uploadForm = {run: null, title: null, description: null, episode: null, error: null, copied: false};
const uploading = run => Boolean(run && run.youtube && run.youtube.state
  && (run.youtube.state.status === 'ready' || run.youtube.state.status === 'uploading'));

async function publishToYouTube(run, title, description, episode) {
  const already = run.youtube.published
    ? `This clip is already recorded as published (${run.youtube.published}). The new video replaces it in the decisions log.\n\n`
    : '';
  if (!window.confirm(`Upload this Lab clip to the YouTube channel as a PRIVATE video?\n\n${title}\n\n${already}`
    + 'It is then recorded as published in output/publish-decisions.json. Make it public in YouTube Studio.')) return;
  const answer = await post('/api/lab/youtube', {id: run.id, title, description, episode, confirmed: true});
  uploadForm.error = answer.ok ? null : (answer.body.problems || [answer.body.error]).join(' ');
  route();
}

function youtubeBox(data, run) {
  const youtube = run.youtube;
  const state = youtube.state;
  const link = (href, text) => h('a', {href, target: '_blank', rel: 'noreferrer noopener'}, text);
  const heading = h('div', {class: 'bar'}, h('b', {}, 'YouTube'), h('span', {class: 'sp'}),
    state && pill(UPLOAD_TONES[state.status], UPLOAD_WORDS[state.status]));
  if (state && state.status === 'done') {
    // YouTube's API cannot set a Short's Related video: opening Studio copies the episode's link to paste there.
    const studio = link(state.studioUrl, state.episodeUrl ? 'Open in YouTube Studio and copy the episode link' : 'Open in YouTube Studio');
    if (state.episodeUrl) {
      studio.addEventListener('click', () => {
        navigator.clipboard.writeText(state.episodeUrl).then(() => {
          Object.assign(uploadForm, {run: run.id, copied: true});
          route();
        }, () => {});
      });
    }
    return h('div', {class: 'gap'}, heading,
      // Links to click, not something the page loads: the addresses come from the server.
      h('div', {class: 'sm gap'}, link(state.url, state.url), ' · ', studio,
        state.episodeUrl ? ' to set its Related video and make it public.' : ' to check it and make it public.'),
      state.episodeUrl && h('div', {class: 'mut sm'}, 'Related video: the full episode, ', link(state.episodeUrl, state.episodeUrl),
        uploadForm.copied && uploadForm.run === run.id ? ' (copied)' : ''),
      state.decision && h('div', {class: 'mut sm'}, `Recorded as published (${state.decision.source}: ${state.decision.headline}).`),
      state.message && h('div', {class: 'sm warning'}, state.message));
  }
  if (uploading(run)) {
    return h('div', {class: 'gap'}, heading, h('div', {class: 'mut sm'}, `Uploading "${state.title}" as a private video…`),
      h('pre', {id: 'youtube-log'}, run.youtubeLog || ''));
  }
  if (uploadForm.run !== run.id) {
    Object.assign(uploadForm, {run: run.id, title: null, description: null, episode: null, error: null, copied: false});
  }
  const title = h('input', {class: 'inp', type: 'text', maxlength: youtube.titleMax, 'aria-label': 'YouTube title',
    value: uploadForm.title !== null ? uploadForm.title : state ? state.title : youtube.defaultTitle});
  const count = h('span', {class: 'mut sm'}, `${title.value.length}/${youtube.titleMax}`);
  title.addEventListener('input', () => {
    uploadForm.title = title.value;
    count.textContent = `${title.value.length}/${youtube.titleMax}`;
  });
  const description = h('textarea', {class: 'inp', rows: 3, 'aria-label': 'YouTube description'},
    uploadForm.description !== null ? uploadForm.description : state ? state.description : youtube.defaultDescription);
  description.addEventListener('input', () => { uploadForm.description = description.value; });
  const episode = h('input', {class: 'inp', type: 'text', placeholder: 'YouTube URL or video ID of the full episode', 'aria-label': 'Full episode on YouTube',
    value: uploadForm.episode !== null ? uploadForm.episode : (state && state.episodeUrl) || youtube.episodeUrl || ''});
  episode.addEventListener('input', () => { uploadForm.episode = episode.value; });
  const busy = Boolean(data.uploading);
  return h('details', {class: 'gap', open: Boolean(state || uploadForm.error)},
    h('summary', {}, 'Publish to YouTube…'),
    state && h('div', {class: 'gap'}, heading),
    state && state.message && h('div', {class: 'sm problem'}, state.message),
    state && state.status !== 'failed' && h('details', {}, h('summary', {class: 'mut sm'}, 'Log'), h('pre', {}, run.youtubeLog || '')),
    youtube.published && h('div', {class: 'sm warning gap'}, 'This clip is already recorded as published: ',
      link(youtube.published, youtube.published)),
    h('label', {}, 'Title'), title, count,
    h('label', {}, 'Description'), description,
    h('label', {}, 'Full episode on YouTube'), episode,
    h('div', {class: 'mut sm'}, 'The description ends with "Full episode: <link>". Remembered for this episode’s other clips. '
      + 'YouTube’s API cannot set a Short’s Related video, so after the upload the page copies this link for you to paste in Studio.'),
    h('div', {class: 'mut sm gap'}, `Uploads this Lab clip to the channel as a ${youtube.privacy} video, then records it as published in output/publish-decisions.json. Make it public in YouTube Studio. One upload per test render.`),
    uploadForm.error && h('div', {class: 'sm problem gap'}, uploadForm.error),
    h('div', {class: 'gap'}, h('button', {class: 'btn p', disabled: busy || !data.python.found,
      onclick: () => publishToYouTube(run, title.value, description.value, episode.value)},
    busy ? 'Another upload is going…' : state ? 'Try the upload again…' : 'Upload to YouTube (private)…')));
}

function compareBox(data, clip, run) {
  const video = (url, missing) => (url
    ? h('video', {controls: true, preload: 'metadata', src: url})
    : h('div', {class: 'novid'}, missing));
  const realUrl = run ? run.realClipUrl : clip && clip.realClip;
  const active = run && (run.status === 'running' || run.status === 'ready');
  return h('div', {class: 'box'},
    h('div', {class: 'bar'}, h('b', {}, run ? run.clip.headline : clip ? clip.headline : 'No clip'),
      h('span', {class: 'sp'}), run && pill(RUN_TONES[run.status], RUN_WORDS[run.status])),
    h('div', {class: 'compare'},
      h('div', {}, h('div', {class: 'mut sm'}, 'Real clip'),
        video(realUrl, 'This clip was never rendered for real, so there is nothing to compare with.')),
      h('div', {}, h('div', {class: 'mut sm'}, 'Lab clip'),
        video(run && run.clipUrl, active ? 'Rendering… this takes a minute or two.'
          : run ? (run.message || 'No clip was written.') : 'No test render yet. Choose a clip and render it.'))),
    run && h('div', {class: 'mut sm gap'}, runSummary(run)),
    run && run.message && h('div', {class: 'sm problem'}, run.message),
    run && h('details', {class: 'gap', open: run.status === 'failed'}, h('summary', {class: 'mut sm'}, 'Log'),
      h('pre', {id: 'lab-log'}, run.log || '')),
    run && run.youtube && youtubeBox(data, run));
}

function renderLab(data, shownRun) {
  const episodes = data.episodes;
  if (!episodes.length) {
    return h('div', {class: 'box mut'}, 'The Lab needs an episode with a local mp3 and an SEO file, and there is none.');
  }
  const episode = episodes.find(ep => ep.stem === labForm.stem) || episodes[0];
  labForm.stem = episode.stem;
  const clip = episode.clips.find(c => c.id === labForm.clip) || episode.clips[0];
  if (labForm.clip !== clip.id) Object.assign(labForm, {clip: clip.id, start: null, end: null, prompt: null, background: null});
  const stills = backgrounds(clip);
  const still = stills.find(option => option.id === labForm.background) || stills[0] || null;
  const draft = chosenDraft(data.drafts);
  const provider = labProvider(data, draft);
  const busy = Boolean(data.active);
  const canRender = data.python.found && !busy && !(draft && draft.problems.length);

  const pick = (options, value, label, onPick) => {
    const select = h('select', {class: 'inp', 'aria-label': label}, options.map(([id, text]) =>
      h('option', {value: id, selected: id === value}, text)));
    select.addEventListener('change', () => {
      onPick(select.value);
      // Another episode or clip leaves the run that was on show (no hashchange: route() redraws).
      if (location.hash.startsWith('#lab/')) history.replaceState(null, '', '#lab');
      route();
    });
    return select;
  };
  const number = (value, field) => {
    const input = h('input', {class: 'inp', type: 'number', step: 'any', min: 0, value, 'aria-label': field});
    input.addEventListener('change', () => { labForm[field] = input.value === '' ? null : Number(input.value); });
    return input;
  };
  // Unlike the pickers above, choosing a background keeps the run that is on show.
  const backgroundPicker = h('select', {class: 'inp', 'aria-label': 'Background'}, stills.map(option =>
    h('option', {value: option.id, selected: still && option.id === still.id}, option.label)));
  backgroundPicker.addEventListener('change', () => { labForm.background = backgroundPicker.value; route(); });
  const prompt = h('textarea', {class: 'inp', rows: 4, 'aria-label': 'Image prompt'},
    labForm.prompt !== null ? labForm.prompt : clip.imagePrompt);
  prompt.addEventListener('change', () => { labForm.prompt = prompt.value; });

  const form = h('div', {class: 'box'},
    h('label', {}, 'Episode'),
    pick(episodes.map(ep => [ep.stem, [ep.number, ep.title, ep.date].filter(Boolean).join(' · ')]), episode.stem, 'Episode',
      value => Object.assign(labForm, {stem: value, clip: null})),
    h('label', {}, 'Clip'),
    pick(episode.clips.map(c => [c.id, clipLabel(c)]), clip.id, 'Clip',
      value => Object.assign(labForm, {clip: value, start: null, end: null, prompt: null, background: null})),
    h('label', {}, 'Window, in seconds of the episode'),
    h('div', {class: 'pair'}, number(labForm.start !== null ? labForm.start : clip.start, 'start'), 'to',
      number(labForm.end !== null ? labForm.end : clip.end, 'end')),
    h('div', {class: 'mut sm'}, `${data.limits.minSeconds} to ${data.limits.maxSeconds} s long. Change it to try a tighter cut.`),
    h('label', {}, 'Draft settings'),
    draftPicker(data.drafts),
    draft
      ? (draft.changes.length
        ? h('div', {class: 'knobs gap'}, draft.changes.map(change => [
          h('span', {class: 'mono wrap'}, change.key),
          h('span', {}, h('span', {class: 'was'}, shown(change.from)), h('b', {}, shown(change.to)))]))
        : h('div', {class: 'mut sm gap'}, 'This draft changes nothing yet.'))
      : h('div', {class: 'mut sm gap'}, 'Renders with config.json as it is.'),
    draft && draft.problems.length > 0 && h('div', {class: 'sm problem'}, draft.problems.join(' ')),
    h('div', {class: 'gap'}, h('a', {href: '#settings'}, draft ? 'Edit this draft in Settings' : 'Make a draft in Settings')),
    still && h('label', {}, 'Background'),
    stills.length > 1 && backgroundPicker,
    still && still.url && h('img', {class: 'still gap', src: still.url, alt: '', title: still.prompt || still.label}),
    h('div', {class: 'bar gap'},
      h('button', {class: 'btn p', disabled: !canRender || !still, onclick: () => render(data, clip, draft, false, still)},
        busy ? 'Rendering…' : 'Render test clip')),
    h('div', {class: 'mut sm gap'}, still
      ? `1 clip · local ffmpeg · reuses ${still.id === 'real' ? 'the real still' : 'the background made in the Lab'} · no network, no cost`
      : 'This clip was never rendered, so there is no still to reuse. It needs a new background.'),
    labForm.error && h('div', {class: 'sm problem gap'}, labForm.error),
    h('details', {class: 'gap', open: !still},
      h('summary', {}, 'New background…'),
      h('label', {}, 'Image prompt for this test (the SEO file is not edited)'),
      prompt,
      h('div', {class: provider.paid ? 'sm warning gap' : 'sm mut gap'}, provider.paid
        ? `One paid image request to ${provider.name} (${provider.model}). You are asked before it is sent.`
        : `One image from the ${provider.name} provider on this Mac. No cost.`,
        provider.name !== data.provider.name ? ` The draft sets the provider; config.json uses ${data.provider.name}.` : ''),
      h('div', {class: 'gap'}, h('button', {class: 'btn', disabled: !canRender, onclick: () => render(data, clip, draft, true)},
        provider.paid ? 'Render with a new background (paid)…' : 'Render with a new background'))));

  const runFor = shownRun || null;
  return [
    h('div', {class: 'bar'},
      h('div', {class: 'chips'}, h('span', {class: 'chip on'}, 'Clip'),
        ['Review clips', 'Thumbnail', 'Transcribe', 'Movies', 'Parse'].map(name =>
          h('span', {class: 'chip off', title: 'Not in the Lab yet'}, name))),
      h('span', {class: 'sp'}), pill('ok', 'Sandbox: a test render writes only to output/lab/')),
    !data.python.found && h('div', {class: 'box gap warning'},
      `The Lab cannot render: no pipeline Python at ${data.python.path}. Start the dashboard with `,
      h('code', {}, '--pipeline-python /path/to/venv/bin/python'), '.'),
    h('div', {class: 'lab'}, form, h('div', {},
      compareBox(data, clip, runFor),
      h('h3', {}, 'Past test renders'),
      data.runs.length ? h('table', {},
        h('tr', {}, ['When', 'Clip', 'Rendered with', 'Result', ''].map(name => h('th', {}, name))),
        data.runs.map(run => h('tr', {},
          h('td', {class: 'sm'}, when(run.createdAt)),
          h('td', {}, h('b', {}, run.clip.headline), h('div', {class: 'mut sm'}, run.stem)),
          h('td', {class: 'sm mut wrap'}, runSummary(run)),
          h('td', {}, pill(RUN_TONES[run.status], RUN_WORDS[run.status]),
            run.youtube && run.youtube.state && [' ', pill(UPLOAD_TONES[run.youtube.state.status], UPLOAD_WORDS[run.youtube.state.status])]),
          h('td', {class: 'right'},
            h('a', {class: 'btn s', href: `#lab/${run.id}`}, 'Show'), ' ',
            h('button', {class: 'btn s', disabled: run.id === data.active, onclick: () => deleteRun(run)}, 'Delete')))))
        : h('div', {class: 'mut sm'}, 'None yet.'))),
    h('h3', {}, 'What a test run touches'),
    h('table', {},
      h('tr', {}, ['Stage', 'In the Lab', 'A test run'].map(name => h('th', {}, name))),
      h('tr', {}, h('td', {}, h('b', {}, 'Clip')), h('td', {}, 'Yes'),
        h('td', {}, 'Renders one clip into its own folder under output/lab/. It reuses the real still, or a background an earlier test render made, so there is no image request and no cost, unless you ask for a new background. The real clip, the SEO file and state.json are not touched.')),
      h('tr', {}, h('td', {}, h('b', {}, 'Review clips, Thumbnail, Movies, Parse, Transcribe')), h('td', {}, 'Not yet'),
        h('td', {}, 'Each needs its own check first. Thumbnail and Movies read Convex.')),
      h('tr', {}, h('td', {}, h('b', {}, 'Publish to YouTube')), h('td', {}, 'When you ask'),
        h('td', {}, 'Uploads one finished test render to the channel as a private video, after you confirm, and records it as published in output/publish-decisions.json. Nothing else leaves this Mac.')),
      h('tr', {}, h('td', {}, h('b', {}, data.neverInLab.map(stageLabel).join(', '))), h('td', {}, 'Never'),
        h('td', {}, 'They write to Convex. The server refuses them here.'))),
  ];
}

// `#lab/<run id>` shows that run beside its real clip; plain `#lab` shows the render in progress, if any.
async function showLab(current, runId) {
  if (labPoll) clearTimeout(labPoll);
  const data = await api('/api/lab');
  const arriving = runId && runId !== labForm.shownRun;
  labForm.shownRun = runId || data.active || null;
  let shownRun = null;
  if (labForm.shownRun) {
    try {
      const answer = await api(`/api/lab/run?id=${encodeURIComponent(labForm.shownRun)}`);
      shownRun = {...answer.run, log: answer.log, youtubeLog: answer.youtubeLog};
      // Arriving at a run puts the form on its episode, clip, window and background, ready to render it again.
      if (arriving) {
        Object.assign(labForm, {stem: shownRun.stem, clip: shownRun.clip.id,
          start: shownRun.clip.start ?? null, end: shownRun.clip.end ?? null,
          prompt: shownRun.edits.imagePrompt ?? null,
          background: shownRun.newBackground ? shownRun.id : shownRun.background || null});
      }
    } catch (error) {
      labForm.shownRun = null; // deleted
    }
  }
  current(renderLab(data, shownRun));
  // While a render or an upload runs, keep its log moving, then redraw once it ends.
  const going = run => run.status === 'running' || run.status === 'ready' || uploading(run);
  const watch = async () => {
    if ((location.hash.slice(1) || 'today').split('/')[0] !== 'lab') return;
    const answer = await api(`/api/lab/run?id=${encodeURIComponent(shownRun.id)}`);
    if (going(answer.run)) {
      for (const [id, text] of [['lab-log', answer.log], ['youtube-log', answer.youtubeLog]]) {
        const log = document.getElementById(id);
        if (log) log.textContent = text;
      }
      labPoll = setTimeout(watch, 1000);
    } else {
      route();
    }
  };
  if (shownRun && going(shownRun)) labPoll = setTimeout(watch, 1000);
}

// --------------------------------------------------------------------------- Clips

const clipsForm = {error: null};
const wholeSeconds = seconds => `${Math.round(seconds)} s`;

function decisionLine(decision) {
  if (!decision) return h('div', {class: 'pills'}, pill('wa', 'Not decided'));
  if (decision.decision === 'published') {
    return h('div', {class: 'pills'}, pill('ok', 'Published'),
      // A link to click, not something the page loads: the address comes from the server.
      decision.youtubeUrl && h('a', {class: 'sm', href: decision.youtubeUrl, target: '_blank', rel: 'noreferrer noopener'},
        `youtube.com/shorts/${decision.youtubeId}`),
      decision.reason && h('span', {class: 'mut sm'}, decision.reason));
  }
  return h('div', {class: 'pills'}, pill('no', 'Skipped'), decision.reason && h('span', {class: 'mut sm'}, decision.reason));
}

// `clip` is what scripts/publish_decisions.py takes: a rendered clip's number, c<candidate>, or rest.
async function decideClip(stem, clip, decision, what) {
  let youtube = null;
  let reason = null;
  if (decision === 'published') {
    youtube = (window.prompt(`YouTube URL or video ID of the Short:\n\n${what}`) || '').trim();
    if (!youtube) return;
  } else {
    const typed = window.prompt(`Why skip it? You can leave this empty.\n\n${what}`);
    if (typed === null) return;
    reason = typed.trim() || null;
  }
  const answer = await post('/api/clips/decide', {stem, clip, decision, youtube, reason});
  clipsForm.error = answer.ok ? null : answer.body.error;
  route();
}

// `main`: a rendered clip still waiting for its decision, the one thing on the tab that needs doing.
function decideButtons(data, clip, row, what, main) {
  const again = row.decision ? 'Replaces the decision already recorded' : null;
  return [
    h('button', {class: main && !row.decision ? 'btn p s' : 'btn s', title: again, onclick: () => decideClip(data.stem, clip, 'published', what)}, 'Published…'),
    h('button', {class: 'btn s', title: again, onclick: () => decideClip(data.stem, clip, 'skipped', what)}, 'Skip…'),
    row.labClip && h('a', {class: 'btn s', href: `#lab/clip/${data.stem}/${row.labClip}`,
      title: 'Opens the Lab on this clip. A test render goes to output/lab/, never over the real clip.'}, 'Open in Lab'),
  ];
}

const longerNote = (row, lengths) => row.longerThanPublished
  && h('div', {class: 'sm warning'}, `Longer than any published Short (the longest ran ${wholeSeconds(lengths.longest)})`);

function clipCard(data, row) {
  return h('div', {class: 'clip box'},
    row.url ? h('video', {controls: true, preload: 'metadata', src: row.url})
      : h('div', {class: 'novid'}, `The rendered file is not on disk: ${row.file}`),
    h('div', {class: 'h'}, row.headline),
    h('div', {class: 'mut sm'}, `${String(row.index).padStart(2, '0')} · ${wholeSeconds(row.seconds)} · starts ${clock(row.start)}`),
    row.why && h('div', {class: 'mut sm'}, row.why),
    longerNote(row, data.lengths),
    decisionLine(row.decision),
    h('div', {class: 'row'}, decideButtons(data, row.index, row, row.headline, true)));
}

function untrackedBox(data) {
  const label = h('input', {class: 'inp', type: 'text', placeholder: 'The bit, for example “Bingo Card”', 'aria-label': 'Label'});
  const youtube = h('input', {class: 'inp', type: 'text', placeholder: 'YouTube URL or video ID', 'aria-label': 'YouTube URL or ID'});
  const note = h('input', {class: 'inp', type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note'});
  // A refused entry is shown here and the form is left as typed.
  const problem = h('div', {class: 'sm problem gap', hidden: true});
  const record = async () => {
    const answer = await post('/api/clips/untracked', {stem: data.stem, label: label.value, youtube: youtube.value, note: note.value});
    if (!answer.ok) {
      problem.textContent = answer.body.error;
      problem.hidden = false;
      return;
    }
    clipsForm.error = null;
    route();
  };
  return h('div', {class: 'box'},
    h('div', {class: 'mut sm'}, 'A Short you published from this episode whose clip is no longer in the pipeline’s output.'),
    data.untracked.map(row => h('div', {class: 'file'}, h('b', {}, row.headline), decisionLine(row))),
    h('div', {class: 'pair gap'}, label, youtube, note, h('button', {class: 'btn', onclick: record}, 'Record')),
    problem);
}

function renderClips(data) {
  if (!data.stem) return h('div', {class: 'box mut'}, 'No episode has rendered clips or publish decisions yet.');
  const picker = h('select', {class: 'btn', 'aria-label': 'Episode'}, data.episodes.map(ep =>
    h('option', {value: ep.stem, selected: ep.stem === data.stem},
      [ep.number, ep.title, ep.date || ep.stem, ep.toReview ? `${ep.toReview} to review` : null].filter(Boolean).join(' · '))));
  picker.addEventListener('change', () => { location.hash = `#clips/${picker.value}`; });
  const step = (stem, text) => h('a', {class: stem ? 'btn' : 'btn off', href: stem ? `#clips/${stem}` : null}, text);
  const named = [data.number, data.title].filter(Boolean).join(' · ');
  const counts = data.counts;
  const undecided = data.rendered.filter(row => !row.decision).length;
  const lengths = data.lengths;
  return [
    h('div', {class: 'bar'},
      h('b', {class: 'big'}, `${named || data.date || data.stem} · rendered clips`),
      h('span', {class: 'mut'}, `${plural(data.rendered.length, 'pick')} rendered · ${plural(data.candidates.length, 'more candidate')}`),
      h('span', {class: 'sp'}), step(data.prev, '← Older'), picker, step(data.next, 'Newer →')),
    h('div', {class: 'bar gap'},
      h('span', {class: 'pill'}, lengths.count
        ? `Published Shorts so far run ${Math.round(lengths.shortest)}–${wholeSeconds(lengths.longest)}` : 'No Short published yet'),
      h('span', {class: 'mut sm'}, `${counts.published} published · ${counts.skipped} skipped · ${counts.undecided} not decided`,
        counts.publishedNotPicked ? ` · ${counts.publishedNotPicked} published from the candidates` : ''),
      h('span', {class: 'sp'}),
      h('a', {class: 'btn s', href: `#episode/${data.stem}`}, 'Open episode'),
      undecided > 0 && h('button', {class: 'btn s', onclick: () => decideClip(data.stem, 'rest', 'skipped',
        `All ${plural(undecided, 'undecided rendered clip')} of this episode`)}, 'Skip the rest…')),
    clipsForm.error && h('div', {class: 'box problem gap'}, clipsForm.error),
    data.rendered.length ? h('div', {class: 'clips gap'}, data.rendered.map(row => clipCard(data, row)))
      : h('div', {class: 'box mut gap'}, 'No picks were rendered for this episode.'),
    h('h3', {}, `Candidates that were not rendered (${data.candidates.length} of ${data.candidateCount})`),
    data.candidates.length ? h('table', {class: 'phrases'},
      h('tr', {}, ['', 'Candidate', 'Length', 'Starts', 'Decision', ''].map(name => h('th', {}, name))),
      data.candidates.map(row => h('tr', {},
        h('td', {class: 'mono mut nowrap'}, `c${row.index}`),
        h('td', {}, h('b', {}, row.headline), row.why && h('div', {class: 'mut sm'}, row.why), longerNote(row, lengths)),
        h('td', {class: 'nowrap'}, wholeSeconds(row.seconds)),
        h('td', {class: 'mut nowrap'}, clock(row.start)),
        h('td', {}, row.decision ? decisionLine(row.decision) : h('span', {class: 'mut'}, '—')),
        h('td', {class: 'right nowrap'}, decideButtons(data, `c${row.index}`, row, row.headline, false)))))
      : h('div', {class: 'mut sm'}, 'None.'),
    !data.lab && h('div', {class: 'mut sm gap'}, 'This episode’s mp3 is not in episodes/, so the Lab cannot render its clips.'),
    h('h3', {}, 'Published, but the clip is gone'),
    untrackedBox(data),
    h('div', {class: 'mut sm gap'}, 'Decisions are saved in ', h('code', {}, 'output/publish-decisions.json'), '. The same from a terminal: ',
      h('code', {}, `python3 scripts/publish_decisions.py list ${data.stem}`)),
  ];
}

// --------------------------------------------------------------------------- Shirts

// What the tab is showing; it survives a redraw. `source` is a scan section, 'episodes' or 'notes'.
const shirtsForm = {source: 'catchphrases', query: '', offset: 0, editing: null, error: null};
let shirtsPoll = null;

const STATUS_TITLES = {idea: 'Ideas', shortlisted: 'Shortlisted', designing: 'Designing', done: 'Done', rejected: 'Rejected'};
const ORIGIN_WORDS = {original: 'Original', quote: 'Quote', unsure: 'Not checked'};
const ORIGIN_TONES = {original: 'ok', quote: 'er', unsure: 'wa'};
const FLAG_TONES = {quote: 'er', known_quote: 'er', unsure: 'wa', person: 'wa', title: 'in'};
const span = row => `${row.firstStem.slice(0, 4)}–${row.lastStem.slice(0, 4)}`;
const clock = s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

// The origin first, then every flag the origin pill has not already said.
function originPills(origin, source, flags) {
  return h('div', {class: 'pills'},
    pill(ORIGIN_TONES[origin], origin === 'quote' ? `Quote · ${source}` : ORIGIN_WORDS[origin]),
    flags.filter(flag => flag.kind !== 'quote' && flag.kind !== 'unsure').map(flag => pill(FLAG_TONES[flag.kind], flag.text)));
}

function hear(url, start) {
  const player = document.getElementById('shirt-audio');
  player.hidden = false;
  player.src = `${url}#t=${Math.max(0, Math.floor(start) - 1)}`;
  player.play();
}

const hearButton = (url, start) => url && h('button', {class: 'btn s', onclick: () => hear(url, start)}, '▶ Hear it');

async function shirtsPost(path, payload) {
  const answer = await post(path, payload);
  shirtsForm.error = answer.ok ? null : answer.body.error;
  route();
  return answer.ok;
}

async function removeIdea(idea) {
  if (!window.confirm(`Take this idea off the list for good?\n\n${idea.printText}\n\nTo keep a record that you turned it down, set it to Rejected instead.`)) return;
  shirtsForm.editing = null;
  shirtsPost('/api/shirts/ideas/delete', {id: idea.id});
}

function ideaEditor(data, idea) {
  const print = h('textarea', {class: 'inp', rows: 2, 'aria-label': 'Text to print'}, idea.printText);
  const origin = h('select', {class: 'inp', 'aria-label': 'Origin'},
    data.origins.map(name => h('option', {value: name, selected: name === idea.origin}, ORIGIN_WORDS[name])));
  const source = h('input', {class: 'inp', type: 'text', value: idea.source || '', placeholder: 'Film, show or song', 'aria-label': 'Source of the quote'});
  const notes = h('textarea', {class: 'inp', rows: 2, 'aria-label': 'Notes'}, idea.notes);
  const sourceRow = h('div', {hidden: idea.origin !== 'quote'}, h('label', {}, 'Quote from'), source);
  origin.addEventListener('change', () => { sourceRow.hidden = origin.value !== 'quote'; });
  // A refused save is shown here and the form is left as typed.
  const problem = h('div', {class: 'sm problem', hidden: true});
  const save = async () => {
    const answer = await post('/api/shirts/ideas/update', {
      id: idea.id, printText: print.value, origin: origin.value,
      source: origin.value === 'quote' ? source.value : null, notes: notes.value});
    if (!answer.ok) {
      problem.textContent = answer.body.error;
      problem.hidden = false;
      return;
    }
    Object.assign(shirtsForm, {editing: null, error: null});
    route();
  };
  return h('div', {class: 'edit'},
    h('label', {}, 'Text to print'), print,
    h('label', {}, 'Origin'), origin, sourceRow,
    h('label', {}, 'Notes'), notes, problem,
    h('div', {class: 'row'},
      h('button', {class: 'btn p s', onclick: save}, 'Save'),
      h('button', {class: 'btn s', onclick: () => { shirtsForm.editing = null; shirtsForm.error = null; route(); }}, 'Cancel'),
      h('span', {class: 'sp'}),
      h('button', {class: 'btn s', onclick: () => removeIdea(idea)}, 'Remove…')));
}

function ideaCard(data, idea) {
  const status = h('select', {class: 'inp', 'aria-label': `Status of ${idea.printText}`},
    data.statuses.map(name => h('option', {value: name, selected: name === idea.status}, STATUS_TITLES[name])));
  status.addEventListener('change', () => shirtsPost('/api/shirts/ideas/update', {id: idea.id, status: status.value}));
  const editing = shirtsForm.editing === idea.id;
  return h('div', {class: 'card'},
    h('div', {class: 'q'}, idea.printText),
    idea.printText !== idea.phrase && h('div', {class: 'mut sm'}, `Said: ${idea.phrase}`),
    originPills(idea.origin, idea.source, idea.flags),
    h('div', {class: 'mut sm'}, `#${idea.id} · from ${idea.fromText}`),
    idea.notes && !editing && h('div', {class: 'sm note'}, idea.notes),
    editing ? ideaEditor(data, idea) : h('div', {class: 'row'}, status,
      h('button', {class: 'btn s', onclick: () => { shirtsForm.editing = idea.id; shirtsForm.error = null; route(); }}, 'Edit'),
      idea.hear && hearButton(idea.hear.url, idea.hear.start)));
}

function board(data) {
  const columns = data.statuses.filter(name => name !== 'rejected');
  const rejected = data.ideas.filter(idea => idea.status === 'rejected');
  return [
    h('div', {class: 'board'}, columns.map(name => {
      const ideas = data.ideas.filter(idea => idea.status === name);
      return h('div', {class: 'col'}, h('b', {}, STATUS_TITLES[name], ' ', h('span', {class: 'mut'}, ideas.length)),
        ideas.length ? ideas.map(idea => ideaCard(data, idea)) : h('div', {class: 'mut sm'}, 'Nothing yet'));
    })),
    rejected.length ? h('details', {class: 'gap', open: rejected.some(idea => idea.id === shirtsForm.editing)},
      h('summary', {class: 'mut sm'}, `Rejected (${rejected.length})`),
      h('div', {class: 'board'}, rejected.map(idea => ideaCard(data, idea)))) : null,
  ];
}

function addIdeaBox() {
  const phrase = h('input', {class: 'inp', type: 'text', placeholder: 'A phrase, as it was said', 'aria-label': 'New idea'});
  const add = () => { if (phrase.value.trim()) shirtsPost('/api/shirts/ideas', {from: 'manual', phrase: phrase.value}); };
  phrase.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
  return h('div', {class: 'pair gap'}, phrase, h('button', {class: 'btn', onclick: add}, 'Add an idea'));
}

const onList = id => h('span', {class: 'tag', title: 'Already on the list above'}, `on the list · #${id}`);

function ignorePhrase(text) {
  if (!window.confirm(`Add this to output/phrases/ignore.txt?\n\n${text}\n\nThe next Rescan leaves it out of every list. To undo, delete its line from ignore.txt.`)) return;
  shirtsPost('/api/shirts/ignore', {phrase: text});
}

function rescanBox(data) {
  const scan = data.scan;
  const rescan = data.rescan;
  const failed = rescan.finishedAt && rescan.returncode !== 0;
  return h('div', {class: 'box gap'},
    h('div', {class: 'bar'},
      dot(rescan.running ? 'in' : scan.stale || !scan.scanned ? 'wa' : 'ok'),
      h('div', {class: 't'},
        h('b', {}, rescan.running ? 'Rescanning… about 20 seconds'
          : !scan.scanned ? 'No phrase report yet'
          : scan.stale ? 'The phrase report is older than the ignore list' : 'The phrase report is up to date with the ignore list'),
        scan.scanned && h('div', {class: 'mut sm'},
          `${plural(scan.transcripts, 'transcript')} (${scan.firstStem}–${scan.lastStem}), scanned ${when(scan.scannedAt)}. `,
          scan.stale && `ignore.txt was saved ${when(scan.ignoreSavedAt)}, so the lists below still show phrases it now hides.`)),
      h('button', {class: 'btn', disabled: rescan.running, title: 'Runs scripts/scan_phrases.py, which rewrites output/phrases/recurring-phrases.json and .md',
        onclick: () => shirtsPost('/api/shirts/rescan', {})}, 'Rescan (about 20 s)')),
    rescan.finishedAt && h('div', {class: failed ? 'sm problem gap' : 'sm mut gap'},
      failed ? (rescan.timedOut ? 'The rescan ran past its time limit and was stopped.' : `The rescan failed (exit ${rescan.returncode}).`)
        : `Rescanned ${when(rescan.finishedAt)}.`),
    rescan.finishedAt && rescan.output && h('pre', {}, rescan.output));
}

function phraseTable(page, rescanning) {
  const filter = h('input', {class: 'inp', type: 'text', value: shirtsForm.query, placeholder: `Find in ${page.title.toLowerCase()}`, 'aria-label': 'Find a phrase'});
  filter.addEventListener('change', () => { shirtsForm.query = filter.value; shirtsForm.offset = 0; route(); });
  const last = page.offset + page.rows.length;
  const turn = by => () => { shirtsForm.offset = Math.max(0, page.offset + by); route(); };
  return [
    h('div', {class: 'pair gap'}, filter,
      h('span', {class: 'mut sm nowrap'}, page.total ? `${(page.offset + 1).toLocaleString()}–${last.toLocaleString()} of ${page.total.toLocaleString()}` : 'None'),
      h('button', {class: 'btn s', disabled: page.offset === 0, onclick: turn(-page.limit)}, '‹ Earlier'),
      h('button', {class: 'btn s', disabled: last >= page.total, onclick: turn(page.limit)}, 'More ›')),
    page.rows.length ? h('table', {class: 'phrases'},
      h('tr', {}, ['Phrase', 'Episodes', 'Span', ''].map(name => h('th', {}, name))),
      page.rows.map(row => {
        const example = row.examples[row.examples.length - 1];
        const heard = [...row.examples].reverse().find(ex => ex.audioUrl);
        return h('tr', {},
          h('td', {}, h('b', {}, row.text), ' ', row.flags.map(flag => pill(FLAG_TONES[flag.kind], flag.text)),
            row.burst && h('div', {class: 'mut sm'}, `${row.burst.count} of ${row.burst.window} episodes in a row, ${row.burst.fromStem}–${row.burst.toStem}`),
            example && h('div', {class: 'mut sm'}, `“${example.text}” `,
              h('a', {href: `#episode/${example.stem}`}, example.stem), ` at ${clock(example.start)}`)),
          h('td', {}, row.episodes.toLocaleString()),
          h('td', {class: 'mut nowrap'}, span(row)),
          h('td', {class: 'right nowrap'}, heard && hearButton(heard.audioUrl, heard.start), ' ',
            row.ideaId ? onList(row.ideaId)
              : h('button', {class: 'btn s', onclick: () => shirtsPost('/api/shirts/ideas', {from: 'scan', phrase: row.text})}, 'Shortlist'), ' ',
            row.ignored
              ? h('span', {class: 'tag', title: 'In output/phrases/ignore.txt; this report was written before it was added'}, 'ignored · Rescan to drop it')
              : h('button', {class: 'btn s', disabled: rescanning, title: rescanning ? 'Wait for the rescan to finish' : 'Add it to output/phrases/ignore.txt',
                onclick: () => ignorePhrase(row.text)}, 'Ignore…')));
      })) : h('div', {class: 'mut sm gap'}, shirtsForm.query
        ? 'No phrase in this list contains that. The counts above show which lists do.' : 'Nothing in this list.'),
  ];
}

function episodePicks(data) {
  if (!data.episodes.length) {
    return h('div', {class: 'mut sm gap'}, 'No episode has a shirts file yet. Cowork writes output/cowork/<stem>.shirts.json for each new episode.');
  }
  return data.episodes.map(ep => h('div', {class: 'box gap'},
    h('div', {class: 'bar'}, h('b', {}, h('a', {href: `#episode/${ep.stem}`}, episodeName(ep)), ep.title ? ` · ${ep.title}` : ''),
      h('span', {class: 'mut sm'}, ep.date || ep.stem), h('span', {class: 'sp'}),
      h('span', {class: 'mut sm'}, ep.problems.length ? 'not valid' : plural(ep.phrases.length, 'phrase'))),
    ep.problems.length ? h('div', {class: 'sm problem'}, `The shirts file is not valid, so nothing is offered from it: ${ep.problems[0]}`) : null,
    ep.phrases.length ? h('table', {class: 'phrases'}, ep.phrases.map(row => h('tr', {},
      h('td', {}, h('b', {}, row.phrase), h('div', {class: 'mut sm'}, `${row.speaker} at ${clock(row.start)} · ${row.why}`)),
      h('td', {}, originPills(row.origin, row.source, row.flags)),
      h('td', {class: 'right nowrap'}, hearButton(ep.audioUrl, row.start), ' ',
        row.ideaId ? onList(row.ideaId)
          : h('button', {class: 'btn s', onclick: () => shirtsPost('/api/shirts/ideas', {from: 'episode', stem: ep.stem, index: row.index})}, 'Shortlist'))))) : null));
}

function notesList(data) {
  const lines = data.notes.lines;
  if (!lines.length) return h('div', {class: 'mut sm gap'}, `No ideas in ${data.notes.file}.`);
  const addLine = line => {
    let phrase = null;
    if (!line.text) {
      phrase = (window.prompt(`This line has no phrase yet:\n\n${line.line}\n\nWhat is the idea?`) || '').trim();
      if (!phrase) return;
    }
    shirtsPost('/api/shirts/ideas', {from: 'notes', line: line.number, phrase});
  };
  const headings = [...new Set(lines.map(line => line.heading))];
  return [
    h('div', {class: 'mut sm gap'}, 'Your own notes, from ', h('code', {}, data.notes.file), '. Adding a line copies it to the list; the file is never changed.'),
    headings.map(heading => h('div', {class: 'box gap'},
      heading && h('b', {}, heading),
      h('table', {class: 'phrases'}, lines.filter(line => line.heading === heading).map(line => h('tr', {},
        h('td', {}, line.text ? h('b', {}, line.text) : h('span', {class: 'mut'}, '(no phrase yet)'),
          line.stem && h('span', {class: 'mut sm'}, ` · ${line.stem}`), ' ',
          line.flags.map(flag => pill(FLAG_TONES[flag.kind], flag.text))),
        h('td', {class: 'right nowrap'}, line.ideaId ? onList(line.ideaId)
          : h('button', {class: 'btn s', onclick: () => addLine(line)}, line.text ? 'Add as an idea' : 'Add as an idea…'))))))),
  ];
}

function renderShirts(data, page) {
  // A search carries over from list to list; the counts beside each list are then its matches.
  const choose = source => () => { location.hash = `#shirts/${source}`; };
  const sections = page ? page.sections : data.scan.sections;
  const chip = (source, title, count) => h('button', {class: `chip ${shirtsForm.source === source ? 'on' : ''}`, onclick: choose(source)},
    title, ' ', h('span', {class: 'mut'}, count.toLocaleString()));
  const listed = data.ideas.filter(idea => idea.status !== 'rejected').length;
  return [
    h('audio', {id: 'shirt-audio', controls: true, preload: 'none', hidden: true}),
    h('div', {class: 'bar'}, h('h3', {}, 'Shortlist'), h('span', {class: 'sp'}),
      h('span', {class: 'mut sm'}, `${plural(listed, 'idea')} · saved in `, h('code', {}, data.file), data.saved ? '' : ' (not written yet)')),
    shirtsForm.error && h('div', {class: 'box problem'}, shirtsForm.error),
    board(data),
    addIdeaBox(),
    h('div', {class: 'box gap sm'}, h('b', {}, 'Before printing. '),
      'A quote is someone else’s line: the biggest catchphrases here are movie quotes. Slater and Goldblum are real people’s names. ',
      '“Not checked” means nobody has looked yet. The flags are shown for you to decide on; nothing here stops a shirt.'),
    h('h3', {}, 'Find phrases'),
    h('div', {class: 'chips'},
      sections.map(section => chip(section.id, section.title, section.count)),
      chip('episodes', 'Episode picks', data.episodes.reduce((sum, ep) => sum + ep.phrases.length, 0)),
      chip('notes', 'Your notes', data.notes.lines.length)),
    shirtsForm.source === 'episodes' ? episodePicks(data)
      : shirtsForm.source === 'notes' ? notesList(data)
      : [rescanBox(data), phraseTable(page, data.rescan.running)],
  ];
}

// `#shirts/<list>` opens the tab on that list: a scan section, `episodes` or `notes`.
async function showShirts(current, source) {
  if (shirtsPoll) clearTimeout(shirtsPoll);
  const data = await api('/api/shirts');
  const sources = [...data.scan.sections.map(row => row.id), 'episodes', 'notes'];
  if (sources.includes(source) && source !== shirtsForm.source) Object.assign(shirtsForm, {source, offset: 0});
  const section = data.scan.sections.find(row => row.id === shirtsForm.source);
  const page = section ? await api(`/api/shirts/phrases?section=${section.id}&q=${encodeURIComponent(shirtsForm.query)}&offset=${shirtsForm.offset}`) : null;
  current(renderShirts(data, page));
  // A rescan takes about 20 s: look again until it has finished, then redraw with the new report.
  const watch = async () => {
    if ((location.hash.slice(1) || 'today').split('/')[0] !== 'shirts') return;
    if ((await api('/api/shirts')).rescan.running) shirtsPoll = setTimeout(watch, 1000);
    else route();
  };
  if (data.rescan.running) shirtsPoll = setTimeout(watch, 1000);
}

// --------------------------------------------------------------------------- Runs

// The one part of the page that starts processes that write to Convex. Every start is checked by the
// server first and confirmed here, showing the exact command.
const runsForm = {mode: 'unattended', stem: null, stage: 'movies', check: null, checking: false, error: null, shown: null};
let runsPoll = null;

const RUN_OUTCOME_TONES = {done: 'ok', cowork: 'in', failed: 'er', stopped: 'wa', interrupted: 'wa', running: 'in', starting: 'in'};
const MODE_WORDS = {
  unattended: 'Unattended, as scheduled_pipeline.sh runs it',
  from: 'One episode, from a stage',
  resume: 'Resume after Cowork',
};
const runWhat = run => (run.mode === 'unattended' ? 'unattended (newest episode from Azure)'
  : `${run.stem} from ${stageLabel(run.stage)}${run.mode === 'resume' ? ' (resume after Cowork)' : ''}`);
const runPill = run => pill(RUN_OUTCOME_TONES[run.status] || 'no', run.outcome || run.status);

function setConvexPill(convex) {
  const holder = document.getElementById('convex-pill');
  if (!holder || !convex) return;
  const tone = !convex.checked ? 'no' : convex.ok ? 'ok' : 'er';
  holder.replaceChildren(dot(tone), 'Convex target ',
    !convex.checked ? 'not checked' : `${convex.ok ? 'passed' : 'failed'} · ${when(convex.at)}`);
  holder.title = convex.checked ? `Last checked from the Runs tab: ${convex.detail}`
    : 'Checked by the Runs tab before every run: check_configuration() runs the Node importer.';
}

function runRequest() {
  const request = {mode: runsForm.mode};
  if (runsForm.mode !== 'unattended') request.stem = runsForm.stem;
  if (runsForm.mode === 'from') request.stage = runsForm.stage;
  return request;
}

async function checkRun() {
  Object.assign(runsForm, {checking: true, error: null});
  route();
  const answer = await post('/api/runs/check', runRequest());
  Object.assign(runsForm, {checking: false, check: answer.ok ? answer.body : null, error: answer.ok ? null : answer.body.error});
  if (answer.ok) setConvexPill(convexFrom(answer.body));
  route();
  return answer.ok ? answer.body : null;
}

const convexFrom = check => {
  const row = check.checks.find(c => c.id === 'configuration');
  return row ? {checked: true, ok: row.ok, at: new Date().toISOString(), detail: row.detail} : null;
};

async function startRun(data) {
  const check = await checkRun();
  if (!check || !check.ok) return; // the failed checks are on the page
  const reaches = check.stages.map(stageLabel).join(', ');
  const cowork = data.headless && check.stages.some(stage => stage === 'movies' || stage === 'parse')
    ? '\n\nHeadless Cowork is on: if Cowork’s files are missing, this starts a claude -p session, which uses your Claude usage.'
    : '';
  const sure = window.confirm(`Start this pipeline run?\n\n${check.command}\n\nIt runs ${reaches}. ` +
    `It writes to Convex${check.stages.includes('import_transcript') ? ' (import_transcript and publish)' : ' (publish)'}.${cowork}`);
  if (!sure) return;
  const answer = await post('/api/runs/start', {...runRequest(), confirmed: true});
  if (!answer.ok) {
    Object.assign(runsForm, {error: answer.body.error, check: answer.body.checks || runsForm.check});
    route();
    return;
  }
  runsForm.shown = answer.body.run.id;
  location.hash = `#runs/${answer.body.run.id}`;
}

async function stopRun(run) {
  if (!window.confirm(`Stop run ${run.id}?\n\nEverything it started is ended. A stop in the middle of import_transcript or publish can leave that write to Convex unfinished.`)) return;
  const answer = await post('/api/runs/stop', {id: run.id});
  if (!answer.ok) runsForm.error = answer.body.error;
  route();
}

function checksBox(check) {
  if (!check) {
    return h('div', {class: 'box sm'}, h('ul', {class: 'checks'},
      ['Data directory exists', 'check_configuration() passes (the Convex target matches its pins)',
        'Credentials are present (names only, never values)', 'ffmpeg has libass', 'Node is 22.6 or newer',
        'No other dashboard run is active'].map(text => h('li', {}, dot('no'), text))),
      h('div', {class: 'mut gap'}, 'Made before every run. Check runs them now without starting anything.'));
  }
  return h('div', {class: 'box sm'},
    h('ul', {class: 'checks'}, check.checks.map(row => h('li', {}, dot(row.ok ? 'ok' : 'er'),
      h('div', {}, h('b', {}, row.label), h('div', {class: row.ok ? 'mut wrap' : 'problem wrap'}, row.detail))))),
    check.credentials.length > 0 && [
      h('h4', {}, 'Credentials'),
      h('table', {}, check.credentials.map(row => h('tr', {class: row.needed ? '' : 'mut'},
        h('td', {class: 'mono'}, row.name),
        h('td', {class: 'nowrap'}, row.set ? pill('ok', 'set') : pill(row.needed ? 'er' : 'no', 'not set')),
        h('td', {class: 'sm mut'}, row.needed ? row.use : `not needed for this run · ${row.use}`))))]);
}

function startBox(data) {
  const busy = Boolean(data.active || data.elsewhere);
  const resumable = data.episodes.filter(ep => ep.resumable);
  const choices = runsForm.mode === 'resume' ? resumable : data.episodes;
  if (runsForm.mode !== 'unattended' && !choices.some(ep => ep.stem === runsForm.stem)) {
    runsForm.stem = choices.length ? choices[0].stem : null;
  }
  const select = (options, value, label, onPick) => {
    const el = h('select', {class: 'inp', 'aria-label': label}, options.map(([id, text]) =>
      h('option', {value: id, selected: id === value}, text)));
    el.addEventListener('change', () => { onPick(el.value); runsForm.check = null; runsForm.error = null; route(); });
    return el;
  };
  const episodeLabel = ep => [ep.number && `Ep ${ep.number}`, ep.title, ep.date].filter(Boolean).join(' · ')
    + (ep.status === 'waiting' ? ' · waiting on Cowork' : '');
  const missingEpisode = runsForm.mode !== 'unattended' && !runsForm.stem;
  return h('div', {class: 'box runs-form'},
    h('label', {}, 'Run'),
    select(Object.entries(MODE_WORDS), runsForm.mode, 'Kind of run', value => { runsForm.mode = value; }),
    runsForm.mode === 'unattended' && h('div', {class: 'mut sm gap'},
      'Finds the newest episode in Azure, downloads it if it is not here, skips it if it is finished, and resumes it if Cowork has written its files. ',
      h('code', {}, 'scheduled_pipeline.sh'), ' runs exactly this, but reports the hand-off to Cowork as exit 0; here it shows as handed to Cowork.'),
    runsForm.mode !== 'unattended' && [
      h('label', {}, 'Episode'),
      choices.length
        ? select(choices.map(ep => [ep.stem, episodeLabel(ep)]), runsForm.stem, 'Episode', value => { runsForm.stem = value; })
        : h('div', {class: 'mut sm'}, runsForm.mode === 'resume'
          ? 'No episode is waiting on Cowork with its files written.' : 'No episode has a local mp3.')],
    runsForm.mode === 'from' && [
      h('label', {}, 'From stage (it runs every stage after it too)'),
      select(data.stages.map(stage => [stage, stageLabel(stage)]), runsForm.stage, 'Stage', value => { runsForm.stage = value; })],
    runsForm.mode === 'resume' && h('div', {class: 'mut sm gap'}, 'Runs from movies to publish with Cowork’s files.'),
    runsForm.check && h('div', {class: 'gap'}, h('label', {}, 'Command'), h('pre', {}, runsForm.check.command)),
    h('div', {class: 'mut sm gap'}, 'Every run reaches publish, which writes to Convex. You are asked before it starts.'),
    data.headless && h('div', {class: 'sm warning gap'},
      'Headless Cowork is on (settings.cowork_headless): a run that needs Cowork’s files starts a claude -p session.'),
    !data.pythonFound && h('div', {class: 'sm problem gap'},
      `No pipeline Python at ${data.python}. Start the dashboard with --pipeline-python pointing at the venv's python.`),
    runsForm.error && h('div', {class: 'sm problem gap'}, runsForm.error),
    h('div', {class: 'bar gap'},
      h('button', {class: 'btn p', disabled: busy || missingEpisode || runsForm.checking || !data.pythonFound,
        onclick: () => startRun(data)}, busy ? 'A run is going' : 'Run…'),
      h('button', {class: 'btn', disabled: missingEpisode || runsForm.checking || !data.pythonFound, onclick: checkRun},
        runsForm.checking ? 'Checking…' : 'Check')));
}

function logBox(data, shown) {
  if (!shown) {
    return h('div', {class: 'box mut'}, 'No run yet. Its log will show here as it runs, and stays in ', h('code', {}, `${data.runsDir}/`), '.');
  }
  const run = shown.run;
  const going = run.status === 'running' || run.status === 'starting';
  return h('div', {class: 'box'},
    h('div', {class: 'bar'}, h('b', {}, runWhat(run)), runPill(run), h('span', {class: 'sp'}),
      going && run.id === (data.active && data.active.id) && h('button', {class: 'btn', onclick: () => stopRun(run)}, 'Stop…')),
    h('div', {class: 'mut sm'}, `${run.id} · started ${when(run.startedAt || run.createdAt)}`,
      run.finishedAt ? ` · ended ${when(run.finishedAt)}` : '',
      run.status === 'cowork' ? ' · exit 75 is the hand-off, not a failure: resume once Cowork has written its files' : '',
      run.status === 'interrupted' ? ' · the dashboard stopped while it ran, so how it ended is not known' : ''),
    h('pre', {id: 'run-log', class: 'log'}, shown.text),
    h('div', {class: 'mut sm'}, `Kept in ${data.runsDir}/${run.id}.log, with every .env value replaced by its name.`));
}

function renderRuns(data, shown) {
  const elsewhere = data.elsewhere;
  return [
    elsewhere && h('div', {class: 'box warning'},
      `Another dashboard has run ${elsewhere.id} going (${runWhat(elsewhere)}). Start nothing here until it ends.`),
    h('div', {class: 'two'},
      h('div', {},
        h('h3', {}, 'Start a run'),
        startBox(data),
        h('h3', {}, 'Checked before every run'),
        checksBox(runsForm.check),
        h('div', {class: 'mut sm gap'},
          'A run started in a terminal (scheduled_pipeline.sh or pipeline.py) is not visible to the last check. ',
          'Make sure none is going before you start one here.')),
      h('div', {},
        h('h3', {}, 'Log'),
        logBox(data, shown),
        h('h3', {}, `Past runs${data.runCount > data.runs.length ? ` (newest ${data.runs.length} of ${data.runCount})` : ''}`),
        data.runs.length ? h('table', {},
          h('tr', {}, ['When', 'Run', 'Result', ''].map(name => h('th', {}, name))),
          data.runs.map(run => h('tr', {class: shown && shown.run.id === run.id ? 'on' : ''},
            h('td', {class: 'sm nowrap'}, when(run.startedAt || run.createdAt)),
            h('td', {class: 'sm'}, runWhat(run)),
            h('td', {}, runPill(run)),
            h('td', {class: 'right'}, h('a', {class: 'btn s', href: `#runs/${run.id}`}, 'Log')))))
          : h('div', {class: 'mut sm'}, 'None yet.'))),
  ];
}

// `#runs/<run id>` shows that run's log; plain `#runs` the run going, else the newest.
// `#runs/from/<stem>` and `#runs/resume/<stem>` fill in the form, then become plain #runs.
async function showRuns(current, argument, stem) {
  if (runsPoll) clearTimeout(runsPoll);
  if ((argument === 'from' || argument === 'resume') && stem) {
    Object.assign(runsForm, {mode: argument, stem, check: null, error: null, shown: null});
    history.replaceState(null, '', '#runs');
    argument = null;
  }
  const data = await api('/api/runs');
  const wanted = argument || (data.active && data.active.id) || (data.runs[0] && data.runs[0].id) || null;
  let shown = null;
  if (wanted) {
    try {
      shown = await api(`/api/runs/log?id=${encodeURIComponent(wanted)}&offset=-1`);
    } catch (error) {
      shown = null;
    }
  }
  current(renderRuns(data, shown));
  const log = document.getElementById('run-log');
  if (log) log.scrollTop = log.scrollHeight;
  // While the run on show is going, add to its log each second; redraw once it ends.
  const watch = async () => {
    if ((location.hash.slice(1) || 'today').split('/')[0] !== 'runs') return;
    const more = await api(`/api/runs/log?id=${encodeURIComponent(shown.run.id)}&offset=${shown.offset}`);
    const pre = document.getElementById('run-log');
    if (pre && more.text) {
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
      pre.append(more.text);
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    }
    shown.offset = more.offset;
    if (more.run.status === 'running' || more.run.status === 'starting') runsPoll = setTimeout(watch, 1000);
    else route();
  };
  if (shown && (shown.run.status === 'running' || shown.run.status === 'starting')) runsPoll = setTimeout(watch, 1000);
}

// --------------------------------------------------------------------------- routing

function show(nodes) {
  view.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
}

function setBadge(id, count) {
  const badge = document.getElementById(id);
  badge.textContent = count;
  badge.hidden = !count;
}

// The two tab badges: things that need Tony, and rendered clips with no publish decision.
function setCounts(today) {
  setBadge('needs-count', today.needs.length);
  setBadge('clips-count', today.clipsToReview);
}

const TABS = ['today', 'episode', 'clips', 'shirts', 'lab', 'runs', 'settings'];
let latestRoute = 0;
let lastTab = null;

async function route() {
  const [tab, argument, ...rest] = (location.hash.slice(1) || 'today').split('/');
  const known = TABS.includes(tab) ? tab : 'today';
  for (const link of document.querySelectorAll('#tabs a')) link.classList.toggle('on', link.dataset.tab === known);
  if (known !== 'settings') applied = null;
  if (known !== 'clips') clipsForm.error = null;
  // A slow answer for a tab the reader has already left must not replace the current one.
  const ticket = ++latestRoute;
  const sameTab = lastTab === known;
  lastTab = known;
  const current = nodes => {
    if (ticket !== latestRoute) return;
    const scroll = window.scrollY;
    show(nodes);
    if (sameTab) window.scrollTo(0, scroll); // an edit redraws the tab; stay where the reader was
  };
  try {
    await ready;
    if (known === 'today') {
      const data = await api('/api/today');
      setCounts(data);
      current(renderToday(data));
    } else if (known === 'settings') {
      current(renderSettings(await api('/api/settings')));
    } else if (known === 'clips') {
      const data = await api(argument ? `/api/clips?stem=${encodeURIComponent(argument)}` : '/api/clips');
      setBadge('clips-count', data.episodes.reduce((sum, ep) => sum + ep.toReview, 0));
      // Plain #clips opens on the episode with clips to review. Keep its address, so deciding
      // the last one does not move the page on to another episode.
      if (!argument && data.stem && ticket === latestRoute) history.replaceState(null, '', `#clips/${data.stem}`);
      current(renderClips(data));
    } else if (known === 'lab' && argument === 'clip' && rest.length === 2) {
      // `#lab/clip/<stem>/<clip id>`: the Clips tab's "Open in Lab". Put the form on that clip, then be plain #lab.
      Object.assign(labForm, {stem: rest[0], clip: rest[1], start: null, end: null, prompt: null, background: null,
        shownRun: null, error: null});
      history.replaceState(null, '', '#lab');
      await showLab(current, null);
    } else if (known === 'lab') {
      await showLab(current, argument);
    } else if (known === 'shirts') {
      await showShirts(current, argument);
    } else if (known === 'runs') {
      await showRuns(current, argument, rest[0]);
    } else {
      const list = await api('/api/episodes');
      const stem = argument || (list[0] && list[0].stem);
      if (!stem) {
        current(h('p', {class: 'mut'}, 'No episodes yet.'));
        return;
      }
      const ep = await api(`/api/episode?stem=${encodeURIComponent(stem)}`);
      document.getElementById('episode-tab').textContent = ep.number ? `Episode ${ep.number}` : 'Episode';
      current(renderEpisode(ep, list));
    }
  } catch (error) {
    current(h('div', {class: 'box problem'}, `Could not load this tab: ${error.message}`));
  }
}

// The header carries the token every POST needs, so nothing is drawn before it has arrived.
async function loadHeader() {
  try {
    const header = await api('/api/header');
    token = header.token;
    document.getElementById('data-dir').textContent = header.dataDir;
    setConvexPill(header.convex);
  } catch (error) {
    document.getElementById('data-dir').textContent = `server not answering: ${error.message}`;
  }
}

const ready = loadHeader();
window.addEventListener('hashchange', route);
route();
ready.then(async () => {
  if ((location.hash.slice(1) || 'today').split('/')[0] !== 'today') {
    try {
      setCounts(await api('/api/today'));
    } catch (error) { /* the tab itself reports a server that is not answering */ }
  }
});
