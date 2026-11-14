// Grammar and spelling, checked locally with Harper (https://writewithharper.com).
// Nothing leaves the computer. Canadian English.
import { LocalLinter, Dialect } from 'harper.js';
import { binary } from 'harper.js/binary';

// Words Harper does not know that are common in clinical and academic writing.
export const SEED_WORDS = [
  'subretinal', 'intraretinal', 'retinal', 'vitreous', 'vitrectomy', 'intravitreal', 'choroidal', 'neovascular', 'macular', 'maculopathy',
  'keratitis', 'keratoconus', 'keratoplasty', 'endothelial', 'endophthalmitis', 'uveitis', 'scleritis', 'episcleritis', 'blepharitis',
  'blepharoptosis', 'ptosis', 'chalazion', 'dacryocystitis', 'nasolacrimal', 'orbitopathy', 'canthotomy', 'cantholysis', 'oculoplastics',
  'oculoplastic', 'neuro-ophthalmology', 'ophthalmology', 'ophthalmologist', 'ophthalmic', 'papilledema', 'papilloedema', 'diplopia',
  'nystagmus', 'strabismus', 'amblyopia', 'glaucomatous', 'trabeculectomy', 'gonioscopy', 'tonometry', 'pachymetry', 'phacoemulsification',
  'pseudophakic', 'aphakic', 'hyphema', 'hypopyon', 'myasthenia', 'retinopathy', 'retinoblastoma', 'melanoma', 'fundoscopy', 'funduscopic',
  'slit-lamp', 'bevacizumab', 'ranibizumab', 'aflibercept', 'faricimab', 'anti-VEGF', 'hemodialysis', 'haemodialysis', 'neuropathic',
  'neuroplasticity', 'polytrauma', 'polytraumas', 'comorbidities', 'comorbidity', 'multimorbidity', 'hyperlipidemia', 'dyslipidemia',
  'preceptor', 'preceptors', 'clerkship', 'clerk', 'residency', 'subspecialty', 'subspecialties', 'interprofessional', 'multidisciplinary',
  'prehospital', 'pulseless', 'attendings', 'unhoused', 'intubation', 'intubated', 'resuscitation', 'triage', 'triaged', 'telehealth',
  'CaRMS', 'Schulich', 'McMaster', 'Dalhousie', 'MCCQE', 'CanMEDS', 'CFMS', 'TriNetX', 'FinnGen', 'pharmacovigilance', 'Mendelian',
];

const ACRONYM = /^[A-Z0-9][A-Z0-9-]{1,7}s?$/;

let linterPromise = null;
let userWords = new Set();

async function getLinter() {
  if (!linterPromise) {
    linterPromise = (async () => {
      const linter = new LocalLinter({ binary, dialect: Dialect.Canadian });
      await linter.setup();
      await linter.importWords(SEED_WORDS);
      return linter;
    })().catch((err) => {
      linterPromise = null;
      throw err;
    });
  }
  return linterPromise;
}

/** Start loading in the background so the first check is quick. */
export function warmUp() {
  getLinter().catch((err) => console.warn('Grammar checker unavailable:', err.message));
}

export async function setUserWords(words = []) {
  const fresh = words.filter((w) => w && !userWords.has(w));
  words.forEach((w) => userWords.add(w));
  if (fresh.length) await (await getLinter()).importWords(fresh);
}

/**
 * Check paragraphs. Returns issues with character offsets inside each paragraph:
 * [{ paraIndex, start, end, text, kind, message, suggestions: [string] }]
 */
export async function checkParagraphs(paragraphs = [], { userDictionary = [] } = {}) {
  const linter = await getLinter();
  await setUserWords(userDictionary);
  const issues = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const text = String(paragraphs[i] ?? '');
    if (!text.trim()) continue;
    const lints = await linter.lint(text);
    for (const l of lints) {
      const span = l.span();
      const problem = l.get_problem_text();
      const kind = l.lint_kind();
      // Acronyms (OCT, CRAO, EDTs) are almost always intentional.
      if ((kind === 'Spelling' || kind === 'Typo') && ACRONYM.test(problem)) continue;
      if (userWords.has(problem)) continue;
      // Sentence length is covered by Cadence's own clarity checks.
      if (kind === 'Readability') continue;
      issues.push({
        paraIndex: i,
        start: span.start,
        end: span.end,
        text: problem,
        kind,
        message: l.message(),
        // Normalise to the full text that replaces the span: Replace = text, Remove = '', InsertAfter = span + text.
        suggestions: [...new Set(l.suggestions().map((s) => {
          const k = s.kind();
          const t = s.get_replacement_text() ?? '';
          return k === 1 ? '' : k === 2 ? problem + t : t;
        }))].slice(0, 4),
      });
    }
  }
  return issues;
}
