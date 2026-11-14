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
  // Word parts: Harper checks each half of a hyphenated word on its own.
  'neuro', 'oculo', 'ophthalmo', 'retro', 'peri', 'intra', 'extra', 'endo', 'post', 'pre', 'non', 'anti', 'sub', 'supra', 'infra', 'trans',
  'pseudo', 'micro', 'macro', 'hemi', 'hypo', 'hyper', 'para', 'multi', 'inter', 'cranio', 'fronto', 'naso', 'orbito', 'chorio', 'vitreo',
  'retinal', 'corneal', 'scleral', 'lamp',
  // Glaucoma, cornea, retina and general ophthalmology.
  'intraocular', 'periocular', 'retrobulbar', 'trabeculoplasty', 'trabecular', 'goniotomy', 'iridotomy', 'iridectomy', 'cyclophotocoagulation',
  'monotherapy', 'polytherapy', 'latanoprost', 'bimatoprost', 'travoprost', 'tafluprost', 'timolol', 'betaxolol', 'brimonidine', 'apraclonidine',
  'dorzolamide', 'brinzolamide', 'acetazolamide', 'methazolamide', 'netarsudil', 'latanoprostene', 'pilocarpine', 'atropine', 'cyclopentolate',
  'tropicamide', 'phenylephrine', 'proparacaine', 'tetracaine', 'fluorescein', 'indocyanine', 'mitomycin', 'fluorouracil', 'triamcinolone',
  'dexamethasone', 'prednisolone', 'difluprednate', 'loteprednol', 'moxifloxacin', 'gatifloxacin', 'ofloxacin', 'vancomycin', 'ceftazidime',
  'natamycin', 'voriconazole', 'valacyclovir', 'acyclovir', 'ganciclovir', 'cyclosporine', 'lifitegrast', 'brolucizumab', 'pegcetacoplan',
  'avacincaptad', 'teprotumumab', 'pseudoexfoliation', 'exfoliation', 'pigmentary', 'normotensive', 'angle-closure', 'gonioscopic',
  'perimetry', 'perimetric', 'visual-field', 'keratometry', 'topography', 'tomography', 'biometry', 'aberrometry', 'endothelium', 'Descemet',
  'Fuchs', 'keratectomy', 'photorefractive', 'LASIK', 'SMILE', 'DMEK', 'DSAEK', 'DSEK', 'DALK', 'PKP', 'crosslinking', 'cross-linking',
  'pterygium', 'pinguecula', 'conjunctivitis', 'conjunctival', 'limbal', 'meibomian', 'blepharospasm', 'dermatochalasis', 'ectropion',
  'entropion', 'trichiasis', 'distichiasis', 'proptosis', 'exophthalmos', 'enophthalmos', 'orbital', 'periorbital', 'lacrimal', 'epiphora',
  'dacryocystorhinostomy', 'drusen', 'geographic', 'exudative', 'nonexudative', 'neovascularization', 'neovascularisation', 'vasculopathy',
  'vitreoretinal', 'vitreomacular', 'epiretinal', 'chorioretinal', 'chorioretinopathy', 'retinoschisis', 'rhegmatogenous', 'tractional',
  'proliferative', 'nonproliferative', 'microaneurysms', 'photocoagulation', 'panretinal', 'endolaser', 'tamponade', 'silicone', 'scleral',
  'buckle', 'optic', 'papillitis', 'neuritis', 'arteritic', 'nonarteritic', 'ischemic', 'ischaemic', 'idiopathic', 'pseudotumor', 'cerebri',
  'hemianopia', 'quadrantanopia', 'anisocoria', 'afferent', 'efferent', 'internuclear', 'ophthalmoplegia', 'ophthalmoparesis', 'mellitus',
  'hypertensive', 'normotensive', 'Humphrey', 'Snellen', 'logMAR', 'ETDRS', 'Goldmann', 'Kaplan', 'Meier', 'Bonferroni', 'Wilcoxon',
  'Mann', 'Whitney', 'Kruskal', 'Wallis', 'Cox', 'Fisher', 'Pearson', 'Spearman', 'Cohen', 'kappa', 'multivariable', 'multivariate',
  'covariate', 'covariates', 'confounder', 'confounders', 'confounding', 'propensity', 'heterogeneity', 'meta-analysis', 'metaanalysis',
  'subgroup', 'subgroups', 'interquartile', 'hazard', 'logistic', 'univariable', 'univariate', 'nomogram', 'pharmacokinetic',
  'fundus', 'fundi', 'bleb', 'blebs', 'miosis', 'mydriasis', 'mydriatic', 'cycloplegic', 'applanation', 'ripasudil', 'hordeolum', 'esotropia',
  'exotropia', 'hypertropia', 'esophoria', 'exophoria', 'mmHg', 'prematurity', 'retinopathy-of-prematurity', 'keratoconjunctivitis', 'sicca',
  'photophobia', 'metamorphopsia', 'scotoma', 'scotomas', 'floaters', 'photopsia', 'vitritis', 'iritis', 'iridocyclitis', 'synechiae',
  'corectopia', 'ectropion', 'buphthalmos', 'megalocornea', 'aniridia', 'coloboma', 'microphthalmia', 'anophthalmia', 'enucleation',
  'evisceration', 'exenteration', 'orbitotomy', 'blepharoplasty', 'tarsorrhaphy', 'tarsal', 'canthal', 'canthus', 'levator', 'frontalis',
  // Reference list words.
  'doi', 'Ophthalmol', 'Ophthalmic', 'Vis', 'Sci', 'Invest', 'Retina', 'Cornea', 'Glaucoma', 'Surv', 'Clin', 'Exp', 'Am', 'Br', 'Eur',
  'Can', 'Jpn', 'Arch', 'Med', 'Res', 'Rev', 'Int', 'Opt', 'et', 'al', 'PMID', 'PMCID', 'eCollection', 'Epub',
  // Canadian places and institutions.
  'Sunnybrook', 'Toronto', 'Mississauga', 'Ontario', 'Saskatoon', 'Edmonton', 'Halifax', 'Kingston', 'Hamilton', 'Montreal', 'Laval',
  'Queen\'s', 'Western', 'Ottawa', 'Calgary', 'Manitoba', 'Sherbrooke',
];

// Never offer these as a one-click fix, whatever the checker suggests.
const BLOCKED_SUGGESTIONS = new Set(['negro', 'negroes', 'nigger', 'niggers', 'faggot', 'fag', 'retard', 'retarded', 'spastic', 'cripple', 'tranny', 'chink', 'gook', 'kike', 'spic', 'wetback', 'dyke', 'slut', 'whore']);

const SUPERSCRIPTS = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g;
const REFERENCE = /^\s*(\[?\d{1,3}[\].)]\s|\d{1,3}\s+[A-Z][a-z]+ [A-Z]{1,3}[,.])|\bdoi[:\s]|\b(19|20)\d{2};\d+/i;

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
  const wanted = new Set(words.filter(Boolean));
  const removed = [...userWords].some((w) => !wanted.has(w));
  if (removed) {
    // Harper can only add words, so start a fresh checker when a word was taken out of the dictionary.
    linterPromise = null;
    userWords = new Set();
  }
  const fresh = [...wanted].filter((w) => !userWords.has(w));
  fresh.forEach((w) => userWords.add(w));
  if (fresh.length) await (await getLinter()).importWords(fresh);
}

/**
 * Check paragraphs. Returns issues with character offsets inside each paragraph:
 * [{ paraIndex, start, end, text, kind, message, suggestions: [string] }]
 */
export async function checkParagraphs(paragraphs = [], { userDictionary = [] } = {}) {
  // Update the dictionary first: removing a word replaces the checker.
  await setUserWords(userDictionary);
  const linter = await getLinter();
  const issues = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const original = String(paragraphs[i] ?? '');
    if (!original.trim()) continue;
    // Superscript citation numbers become spaces of the same length, so offsets stay right.
    const text = original.replace(SUPERSCRIPTS, ' ');
    const isReference = REFERENCE.test(text);
    const sup = [...original.matchAll(SUPERSCRIPTS)].map((m) => m.index);
    const lints = await linter.lint(text);
    // Let other requests in between paragraphs, so a long check never freezes saving.
    if (i % 20 === 19) await new Promise((r) => setImmediate(r));
    for (const l of lints) {
      const span = l.span();
      const problem = l.get_problem_text();
      const kind = l.lint_kind();
      // Acronyms (OCT, CRAO, EDTs) are almost always intentional.
      if ((kind === 'Spelling' || kind === 'Typo') && ACRONYM.test(problem)) continue;
      if (userWords.has(problem)) continue;
      // Sentence length is covered by Cadence's own clarity checks.
      if (kind === 'Readability') continue;
      const spelling = kind === 'Spelling' || kind === 'Typo';
      // Reference lists are full of names and journal abbreviations.
      if (isReference && spelling) continue;
      // Capitalised words in mid-sentence are almost always names (Micieli, Sunnybrook).
      const before = text.slice(0, span.start);
      const sentenceStart = !before.trim() || (/[.!?]["')\]]*\s*$/.test(before) && !/\b(Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|al|e\.g|i\.e)\.\s*$/i.test(before));
      if (spelling && /^[A-Z][a-z]/.test(problem) && !sentenceStart) continue;
      // "83 um" is micrometres, not a filler word.
      if (/^(um|µm)$/i.test(problem.trim()) && /\d\s*$/.test(before + problem.match(/^\s*/)[0])) continue;
      // Nothing about the superscript citation numbers themselves.
      if (sup.some((k) => k >= span.start && k < span.end)) continue;
      // Number ranges and test names like 24-2 keep their hyphen.
      if (/^\d+\s*[-–]\s*\d+$/.test(problem) || /\ben dash\b/i.test(l.message())) continue;
      issues.push({
        paraIndex: i,
        start: span.start,
        end: span.end,
        text: problem,
        kind,
        message: /^Did you mean to spell/.test(l.message()) ? 'Possible spelling mistake.' : l.message(),
        // Normalise to the full text that replaces the span: Replace = text, Remove = '', InsertAfter = span + text.
        suggestions: [...new Set(l.suggestions().map((s) => {
          const k = s.kind();
          const t = s.get_replacement_text() ?? '';
          return k === 1 ? '' : k === 2 ? problem + t : t;
        }))].filter((x) => !BLOCKED_SUGGESTIONS.has(x.toLowerCase().trim())).slice(0, 4),
      });
    }
  }
  return issues;
}
