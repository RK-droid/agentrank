// Keyword categories (first match wins), applied to a repo's name, description and topics.
// Shown on the site as "auto-categorised"; makers can request a correction.
const CODE = /(?<![\w-])(coding|code|coder)(?![\w-])/i;
export const CATS = [
  ['Vibe coding', /\b(vibe[- ]?cod|app builder|text[- ]to[- ]app|prompt[- ]to[- ]app|ai app generator|lovable|bolt\.new|full[- ]stack app generat)/i],
  ['Editing', /\b(video[- ]edit|edit(ing)? videos?|photo[- ]edit|image[- ]edit|audio[- ]edit|podcast edit|subtitles?|video generat|short[- ]form video|reels?\b)/i],
  ['Design', /\b(design[- ](agent|tool|assistant|system|to[- ]code)|ui[- ]design|ux[- ]design|ui\/ux|figma|web design|graphic design|logo design|designer agent|ai designer)/i],
  ['Copywriting & content', /\b(copywrit|writing (agent|assistant|tool)|ai writer|blog (post|writ)|article (generat|writ)|content (creat|generat|writ)|newsletter|storytell|novel[- ]writ|humaniz)/i],
  ['Marketing & sales', /\b(marketing|seo\b|growth hack|sales (agent|automation)|lead[- ]?gen|cold (email|outreach)|social media|ad (copy|campaigns?)|crm\b)/i],
  ['Decision making & research', /\b(decision[- ](making|support|agent)|deep[- ]?research|research (agent|assistant)|autonomous research|due diligence|forecast(ing)?|analyst agent)/i],
  ['Multi-agent setups', /\b(multi[- ]?agent|orchestrat|swarm|crewai|agent teams?|team of agents)/i],
  ['Agent builders & platforms', /\b(no-?code|low-?code|workflow automation|visual builder|agent platform|llmops|rag pipeline|agent builder)/i],
  ['Skills & plugins', /\b(skills?\b|plugins?\b|mcp server|extensions?\b|claude\.md|agents\.md|subagents?)/i],
  ['Coding', null],
  ['Browser & computer use', /\b(browser|web ?automation|computer[- ]use|desktop automation|playwright|selenium|scrap)/i],
  ['Data & analytics', /\b(data ?analy|sql|database|spreadsheet|analytics|pandas)/i],
  ['Voice & chat', /\b(voice|speech|realtime|phone call|chatbot|telegram|discord|slack|whatsapp)/i],
  ['Finance & trading', /\b(trad(e|ing)\b|financ|stock|crypto|defi|quant)/i],
  ['Frameworks & SDKs', /\b(framework|sdk|library|toolkit|infrastructure|runtime|protocol|mcp)/i],
  ['General assistants', /\b(assistant|personal agent|general[- ]purpose|jarvis|copilot|autonomous)/i],
];
export function categorise(r) {
  const text = `${r.name} ${r.description || ''} ${(r.topics || []).join(' ')}`;
  for (const [name, re] of CATS) {
    if (name === 'Coding' ? CODE.test(text) || /\b(developer|programm|software engineer|ide\b|vscode|terminal|cli\b|swe\b|pull request|refactor)/i.test(text) : re.test(text)) return name;
  }
  return 'General';
}
