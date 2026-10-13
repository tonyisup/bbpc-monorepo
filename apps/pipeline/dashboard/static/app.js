// BBPC pipeline dashboard. Every figure is computed by the server (dashboard/views.py);
// this file lays it out. Looking only sends GET requests. The Lab and its drafts send
// POSTs, each carrying the token the server made when it started.
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
  inferred: 'inferred from state.json, not checked', unknown: 'no way to tell from local files',
};
const STATE_MARKS = {done: '✓', partial: '◐', missing: '–', waiting: '…', inferred: '✓', unknown: '?'};
const stageLabel = stage => STAGE_LABELS[stage] || stage;
const stageTitle = row => `${stageLabel(row.stage)}: ${STATE_WORDS[row.state]}. ${row.detail}`;

function rail(stages) {
  return h('span', {class: 'rail'}, stages.map(row => h('i', {class: row.state, title: stageTitle(row)})));
}

function stageLegend() {
  const key = (state, text) => h('span', {}, h('span', {class: 'rail'}, h('i', {class: state})), text);
  return h('div', {class: 'legend mut sm'},
    key('done', 'file found'), key('partial', 'some files'), key('waiting', 'waiting on Cowork'),
    key('missing', 'no file'), key('inferred', 'inferred from state.json, not checked'),
    key('unknown', 'cannot tell'));
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
      h('div', {class: 'mut sm'}, need.title ? `${need.title} · ` : '', 'Record each one with ',
        h('code', {}, `python3 scripts/publish_decisions.py list ${need.stem}`))),
      h('a', {class: 'btn', href: `#episode/${need.stem}`}, 'Open episode'));
  }
  if (need.kind === 'cowork') {
    const ready = need.ready && need.ok;
    return h('div', {}, dot(ready ? 'in' : 'wa'), h('div', {class: 't'},
      h('b', {}, `${episodeName(need)} · ${ready ? "Cowork's files are ready" : 'waiting on Cowork'}`),
      h('div', {class: 'mut sm'}, coworkSummary(need.files)),
      ready && h('div', {class: 'mut sm'}, 'Resume with ',
        h('code', {}, `python pipeline.py episodes/${need.stem}.mp3 --from movies`)),
      !ready && need.headless && h('div', {class: 'mut sm'},
        'Headless Cowork is on, so its session failed or was skipped. Run the pipeline again to retry it, or write the files in Cowork.'),
      need.lastError && h('pre', {}, `Last error: ${need.lastError}`)),
      h('a', {class: 'btn', href: `#episode/${need.stem}`}, 'Open episode'));
  }
  if (need.kind === 'phrases') {
    return h('div', {}, dot('wa'), h('div', {class: 't'},
      h('b', {}, 'Phrase report is older than the ignore list'),
      h('div', {class: 'mut sm'}, `Report saved ${when(need.reportSavedAt)}, ignore.txt saved ${when(need.ignoreSavedAt)}. `,
        'Rescan (about 20 s) with ', h('code', {}, 'python3 scripts/scan_phrases.py'))));
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
      h('span', {class: 'sp'}), step(ep.prev, '← Older'), picker, step(ep.next, 'Newer →')),
    ep.audio
      ? h('audio', {controls: true, preload: 'none', src: ep.audio.url})
      : h('div', {class: 'mut sm gap'}, `No local mp3 for this episode, so there is nothing to play. ${plural(ep.audioEpisodes, 'episode has', 'episodes have')} one.`),
    h('h3', {}, 'Stages'),
    h('div', {class: 'stages'}, ep.stages.map(row => h('div', {class: `stage ${row.state}`, title: stageTitle(row)},
      h('b', {}, STATE_MARKS[row.state]), stageLabel(row.stage),
      h('span', {class: 'd'}, row.checked ? row.detail : `${row.state}: no local file`)))),
    h('div', {class: 'mut sm gap'},
      'Solid boxes were checked against a file. Dashed and dotted boxes (import, publish) leave no local file, so they are read from state.json: ',
      state.status ? h('b', {}, state.status) : h('b', {}, 'no entry'),
      state.updatedAt ? `, updated ${when(state.updatedAt)}` : '', state.note ? ` (${state.note})` : '', '.'),
    state.lastError && h('pre', {}, `Last error: ${state.lastError}`),
    h('div', {class: 'two'},
      h('div', {},
        h('h3', {}, 'Cowork files'),
        h('div', {class: 'box'}, ep.cowork.files.map(file => coworkFile(file, state)),
          !ep.cowork.transcriptFound && h('div', {class: 'mut sm gap'},
            'Transcript not found, so the duration, segment-boundary and phrase-text checks were skipped.')),
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
const labForm = {stem: null, clip: null, start: null, end: null, prompt: null, shownRun: null, error: null};
let labPoll = null;

const seconds = clip => Math.round(clip.end - clip.start);
const clipLabel = clip => (clip.source === 'pick'
  ? `${String(clip.index).padStart(2, '0')} · ${clip.headline} · ${seconds(clip)} s`
  : `c${clip.index} · ${clip.headline} · ${seconds(clip)} s · no still`);
const RUN_WORDS = {ready: 'starting', running: 'rendering', done: 'done', failed: 'failed', interrupted: 'interrupted'};
const RUN_TONES = {ready: 'in', running: 'in', done: 'ok', failed: 'er', interrupted: 'wa'};

async function render(data, clip, draft, newBackground) {
  const edits = {};
  if (labForm.start !== null && labForm.start !== clip.start) edits.start = labForm.start;
  if (labForm.end !== null && labForm.end !== clip.end) edits.end = labForm.end;
  if (newBackground && labForm.prompt !== null && labForm.prompt !== clip.imagePrompt) edits.imagePrompt = labForm.prompt;
  if (newBackground && data.provider.paid && !window.confirm(
    `This makes ONE PAID image request to ${data.provider.name} (${data.provider.model}).\n\nContinue?`)) return;
  const answer = await post('/api/lab/runs', {
    stem: labForm.stem, clip: clip.id, stage: 'clip', draft: draft ? draft.name : null, edits,
    newBackground, confirmPaid: newBackground && data.provider.paid,
  });
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
    run.newBackground ? `new background (${run.provider}${run.paid ? ', paid' : ''})` : 'reused still',
  ].filter(Boolean).join(' · ');
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
      h('pre', {id: 'lab-log'}, run.log || '')));
}

function renderLab(data, shownRun) {
  const episodes = data.episodes;
  if (!episodes.length) {
    return h('div', {class: 'box mut'}, 'The Lab needs an episode with a local mp3 and an SEO file, and there is none.');
  }
  const episode = episodes.find(ep => ep.stem === labForm.stem) || episodes[0];
  labForm.stem = episode.stem;
  const clip = episode.clips.find(c => c.id === labForm.clip) || episode.clips[0];
  if (labForm.clip !== clip.id) Object.assign(labForm, {clip: clip.id, start: null, end: null, prompt: null});
  const draft = chosenDraft(data.drafts);
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
  const prompt = h('textarea', {class: 'inp', rows: 4, 'aria-label': 'Image prompt'},
    labForm.prompt !== null ? labForm.prompt : clip.imagePrompt);
  prompt.addEventListener('change', () => { labForm.prompt = prompt.value; });

  const form = h('div', {class: 'box'},
    h('label', {}, 'Episode'),
    pick(episodes.map(ep => [ep.stem, [ep.number, ep.title, ep.date].filter(Boolean).join(' · ')]), episode.stem, 'Episode',
      value => Object.assign(labForm, {stem: value, clip: null})),
    h('label', {}, 'Clip'),
    pick(episode.clips.map(c => [c.id, clipLabel(c)]), clip.id, 'Clip',
      value => Object.assign(labForm, {clip: value, start: null, end: null, prompt: null})),
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
    h('div', {class: 'bar gap'},
      h('button', {class: 'btn p', disabled: !canRender || !clip.hasStill, onclick: () => render(data, clip, draft, false)},
        busy ? 'Rendering…' : 'Render test clip')),
    h('div', {class: 'mut sm gap'}, clip.hasStill
      ? '1 clip · local ffmpeg · reuses the real still · no network, no cost'
      : 'This clip was never rendered, so there is no still to reuse. It needs a new background.'),
    labForm.error && h('div', {class: 'sm problem gap'}, labForm.error),
    h('details', {class: 'gap', open: !clip.hasStill},
      h('summary', {}, 'New background…'),
      h('label', {}, 'Image prompt for this test (the SEO file is not edited)'),
      prompt,
      h('div', {class: data.provider.paid ? 'sm warning gap' : 'sm mut gap'}, data.provider.paid
        ? `One paid image request to ${data.provider.name} (${data.provider.model}). You are asked before it is sent.`
        : `One image from the ${data.provider.name} provider on this Mac. No cost.`),
      h('div', {class: 'gap'}, h('button', {class: 'btn', disabled: !canRender, onclick: () => render(data, clip, draft, true)},
        data.provider.paid ? 'Render with a new background (paid)…' : 'Render with a new background'))));

  const runFor = shownRun || null;
  return [
    h('div', {class: 'bar'},
      h('div', {class: 'chips'}, h('span', {class: 'chip on'}, 'Clip'),
        ['Review clips', 'Thumbnail', 'Transcribe', 'Movies', 'Parse'].map(name =>
          h('span', {class: 'chip off', title: 'Not in the Lab yet'}, name))),
      h('span', {class: 'sp'}), pill('ok', 'Sandbox: writes only to output/lab/')),
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
          h('td', {}, pill(RUN_TONES[run.status], RUN_WORDS[run.status])),
          h('td', {class: 'right'},
            h('a', {class: 'btn s', href: `#lab/${run.id}`}, 'Show'), ' ',
            h('button', {class: 'btn s', disabled: run.id === data.active, onclick: () => deleteRun(run)}, 'Delete')))))
        : h('div', {class: 'mut sm'}, 'None yet.'))),
    h('h3', {}, 'What a test run touches'),
    h('table', {},
      h('tr', {}, ['Stage', 'In the Lab', 'A test run'].map(name => h('th', {}, name))),
      h('tr', {}, h('td', {}, h('b', {}, 'Clip')), h('td', {}, 'Yes'),
        h('td', {}, 'Renders one clip into its own folder under output/lab/. It reuses the real still, so there is no image request and no cost, unless you ask for a new background. The real clip, the SEO file and state.json are not touched.')),
      h('tr', {}, h('td', {}, h('b', {}, 'Review clips, Thumbnail, Movies, Parse, Transcribe')), h('td', {}, 'Not yet'),
        h('td', {}, 'Each needs its own check first. Thumbnail and Movies read Convex.')),
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
      shownRun = {...answer.run, log: answer.log};
      // Arriving at a run puts the form on its episode and clip, ready to render it again.
      if (arriving) Object.assign(labForm, {stem: shownRun.stem, clip: shownRun.clip.id, start: null, end: null, prompt: null});
    } catch (error) {
      labForm.shownRun = null; // deleted
    }
  }
  current(renderLab(data, shownRun));
  // While a render runs, keep the log moving, then redraw once it ends.
  const watch = async () => {
    if ((location.hash.slice(1) || 'today').split('/')[0] !== 'lab') return;
    const answer = await api(`/api/lab/run?id=${encodeURIComponent(shownRun.id)}`);
    if (answer.run.status === 'running' || answer.run.status === 'ready') {
      const log = document.getElementById('lab-log');
      if (log) log.textContent = answer.log;
      labPoll = setTimeout(watch, 1000);
    } else {
      route();
    }
  };
  if (shownRun && (shownRun.status === 'running' || shownRun.status === 'ready')) labPoll = setTimeout(watch, 1000);
}

// --------------------------------------------------------------------------- routing

function show(nodes) {
  view.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
}

function setNeedsCount(count) {
  const badge = document.getElementById('needs-count');
  badge.textContent = count;
  badge.hidden = !count;
}

const TABS = ['today', 'episode', 'lab', 'settings'];
let latestRoute = 0;
let lastTab = null;

async function route() {
  const [tab, argument] = (location.hash.slice(1) || 'today').split('/');
  const known = TABS.includes(tab) ? tab : 'today';
  for (const link of document.querySelectorAll('#tabs a')) link.classList.toggle('on', link.dataset.tab === known);
  if (known !== 'settings') applied = null;
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
      setNeedsCount(data.needs.length);
      current(renderToday(data));
    } else if (known === 'settings') {
      current(renderSettings(await api('/api/settings')));
    } else if (known === 'lab') {
      await showLab(current, argument);
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
    document.getElementById('convex').textContent = header.convex;
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
      setNeedsCount((await api('/api/today')).needs.length);
    } catch (error) { /* the tab itself reports a server that is not answering */ }
  }
});
