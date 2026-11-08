const TRADITIONAL_TEAM_NAMES: Record<string, string> = {
  "Manchester United": "曼聯",
  "Manchester City": "曼城",
  "Arsenal": "阿仙奴",
  "Liverpool": "利物浦",
  "Chelsea": "車路士",
  "Tottenham Hotspur": "熱刺",
  "Newcastle": "紐卡素",
  "Real Madrid": "皇家馬德里",
  "Barcelona": "巴塞隆拿",
  "Atletico Madrid": "馬德里體育會",
  "Athletic Club": "畢爾包競技",
  "Valencia": "華倫西亞",
  "Villarreal": "維拉利爾",
  "Juventus": "祖雲達斯",
  "AC Milan": "AC米蘭",
  "Inter": "國際米蘭",
  "Napoli": "拿玻里",
  "Roma": "羅馬",
  "Lazio": "拉素",
  "Atalanta": "阿特蘭大",
  "Bayern Munich": "拜仁慕尼黑",
  "Dortmund": "多蒙特",
  "Bayer Leverkusen": "利華古遜",
  "RB Leipzig": "RB萊比錫",
  "Frankfurt": "法蘭克福",
  "Paris Saint Germain": "巴黎聖日耳門",
  "Marseille": "馬賽",
  "Lyon": "里昂",
  "Monaco": "摩納哥",
  "Lille": "里爾",
  "Bristol City": "布里斯托城",
  "Millwall": "米爾沃",
  "Inter Miami": "國際邁阿密",
  "Inter Miami CF": "國際邁阿密",
  "Los Angeles FC": "洛杉磯FC",
  "LA Galaxy": "洛杉磯銀河",
  "Seattle Sounders": "西雅圖海灣者",
  "Portland Timbers": "波特蘭伐木者",
  "Orlando City SC": "奧蘭多城",
  "FC Cincinnati": "辛辛那提FC",
  "Chicago Fire": "芝加哥火焰",
  "Vissel Kobe": "神戶勝利船",
  "FC Tokyo": "FC東京",
  "Yokohama F. Marinos": "橫濱水手",
  "Urawa Reds": "浦和紅鑽",
  "Kashima Antlers": "鹿島鹿角",
  "Kawasaki Frontale": "川崎前鋒",
  "Gamba Osaka": "大阪飛腳",
  "Cerezo Osaka": "大阪櫻花",
  "Sanfrecce Hiroshima": "廣島三箭",
  "Jeju United FC": "濟州SK",
  "Jeju United": "濟州SK",
  "FC Anyang": "安養FC",
  "Ulsan HD FC": "蔚山HD",
  "Jeonbuk Hyundai Motors": "全北現代",
  "Pohang Steelers": "浦項製鐵",
  "FC Seoul": "FC首爾",
  "Melbourne Victory": "墨爾本勝利",
  "Melbourne City": "墨爾本城",
  "Sydney FC": "悉尼FC",
  "Western Sydney Wanderers": "西悉尼流浪者",
  "Central Coast Mariners": "中岸水手",
  "Shanghai Port": "上海海港",
  "Shanghai Shenhua": "上海申花",
  "Beijing Guoan": "北京國安",
  "Shandong Luneng": "山東泰山",
  "Chengdu Rongcheng": "成都蓉城",
  "Shenyang Urban": "瀋陽城市",
  "Sichuan Jiuniu": "四川九牛",
  "Flamengo": "法林明高",
  "Palmeiras": "彭美拉斯",
  "Corinthians": "哥連泰斯",
  "Sao Paulo": "聖保羅",
  "Fluminense": "富明尼斯",
  "America Mineiro": "明尼路美洲",
  "Cruzeiro": "高士路",
  "Internacional": "國際體育會",
  "Remo": "雷莫",
  "Fluminense W": "富明尼斯女足",
  "Fluminense Women": "富明尼斯女足",
  "America Mineiro W": "明尼路美洲女足",
  "America Mineiro Women": "明尼路美洲女足",
  "América Mineiro W": "明尼路美洲女足",
  "América Mineiro Women": "明尼路美洲女足",
  "Club America": "墨西哥美洲",
  "Guadalajara": "瓜達拉哈拉",
  "Cruz Azul": "藍十字",
  "Monterrey": "蒙特雷",
  "Tigres": "堤格雷斯",
  "Tijuana": "提華納",
  "Atlante FC": "亞特蘭蒂",
  "Atlante": "亞特蘭蒂",
  "Toluca": "托盧卡",
  "Deportivo Toluca": "托盧卡",
  "Toluca FC": "托盧卡",
  "Pumas UNAM": "普馬斯",
  "Necaxa": "尼卡沙",
  "Pachuca": "帕丘卡",
  "Leon": "利昂",
  "León": "利昂",
  "Santos Laguna": "山度士拉古納",
  "Atlas": "阿特拉斯",
  "Juarez": "華雷斯",
  "FC Juarez": "華雷斯",
  "Puebla": "普埃布拉",
  "Queretaro": "克雷塔羅",
  "Querétaro": "克雷塔羅",
  "Mazatlan FC": "馬薩特蘭",
  "Mazatlán FC": "馬薩特蘭",
  "Atletico San Luis": "聖路易斯體育會",
  "Atlético San Luis": "聖路易斯體育會",
  "Cancun FC": "坎昆FC",
  "Venados FC": "梅里達雄鹿",
  "CD Tapatio": "塔帕蒂奧",
  "Cimarrones de Sonora": "索諾拉野馬",
  "Toronto FC": "多倫多FC",
  "CF Montreal": "蒙特利爾CF",
  "Vancouver Whitecaps": "溫哥華白帽",
  "Forge FC": "鍛造FC",
  "Cavalry FC": "騎兵FC",
  "LD Alajuelense": "阿拉祖蘭斯",
  "Deportivo Saprissa": "薩普里沙",
  "CS Herediano": "希雷迪亞諾",
  "CD Olimpia": "奧林比亞",
  "FC Motagua": "莫塔瓜",
  "Comunicaciones": "通訊隊",
  "Municipal": "市政隊",
  "Bochum": "波琴",
  "Wolfsburg": "禾夫斯堡",
  "UNAM Pumas": "普馬斯"
};

// Exact provider spellings only: never fuzzy-match a short or shared club name.
const TEAM_NAME_ALIASES: Record<string, string> = {
  "CF Pachuca": "Pachuca",
  "Club Tijuana": "Tijuana",
  "Guadalajara Chivas": "Guadalajara",
  "VfL Bochum": "Bochum",
  "VfL Bochum 1848": "Bochum",
  "VfL Wolfsburg": "Wolfsburg",
  "U.N.A.M. - Pumas": "UNAM Pumas",
  "U.N.A.M.-Pumas": "UNAM Pumas",
  "UNAM - Pumas": "UNAM Pumas",
  "Pumas UNAM": "UNAM Pumas",
  Urawa: "Urawa Reds",
  "Urawa Red Diamonds": "Urawa Reds",
};

function normalizeTeamName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const normalizedNames = new Map(Object.entries(TRADITIONAL_TEAM_NAMES).map(([english, chinese]) => [normalizeTeamName(english), chinese]));
for (const [alias, canonical] of Object.entries(TEAM_NAME_ALIASES)) {
  normalizedNames.set(normalizeTeamName(alias), TRADITIONAL_TEAM_NAMES[canonical]);
}

const runtimeTranslations = new Map<string,string>();
export function registerRuntimeTeamTranslation(english: string, chinese: string): void { if (chinese.trim()) runtimeTranslations.set(normalizeTeamName(english),chinese.trim()); }
export function clearRuntimeTeamTranslation(english: string): void { runtimeTranslations.delete(normalizeTeamName(english)); }
export type TraditionalNameFields = {
  nameZhHk?: string | null;
  nameZhTw?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function selectTraditionalName(englishName: string, translation?: TraditionalNameFields): string | null {
  // Keep an authoritative translation (including an upstream ID-keyed lookup)
  // ahead of display aliases. Names are presentation, not team identity.
  return nonEmpty(translation?.nameZhHk)
    ?? nonEmpty(translation?.nameZhTw)
    ?? runtimeTranslations.get(normalizeTeamName(englishName))
    ?? normalizedNames.get(normalizeTeamName(englishName))
    ?? (() => { const base=englishName.trim().replace(/\s+(W|Women)$/i, ""); if(base===englishName.trim()) return null; const name=normalizedNames.get(normalizeTeamName(base)) ?? runtimeTranslations.get(normalizeTeamName(base)); return name ? `${name}女足` : null; })();
}

export function localizeTeamName(englishName: string): string {
  return selectTraditionalName(englishName) ?? englishName.trim();
}

export function formatTranslatedTeamDisplay(englishName: string, translation?: TraditionalNameFields): string {
  const original = englishName.trim();
  const traditional = selectTraditionalName(original, translation);
  return !traditional || traditional === original ? original : `${traditional} (${original})`;
}

export function formatTeamDisplay(englishName: string): string {
  return formatTranslatedTeamDisplay(englishName);
}

export function formatFixtureDisplay(homeTeam: string, awayTeam: string): string {
  return `${formatTeamDisplay(homeTeam)} vs ${formatTeamDisplay(awayTeam)}`;
}
