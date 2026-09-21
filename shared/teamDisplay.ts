const TRADITIONAL_TEAM_NAMES: Record<string, string> = {
  "Manchester United": "曼聯", "Manchester City": "曼城", Arsenal: "阿仙奴", Liverpool: "利物浦", Chelsea: "車路士", "Tottenham Hotspur": "熱刺", Newcastle: "紐卡素",
  "Real Madrid": "皇家馬德里", Barcelona: "巴塞隆拿", "Atletico Madrid": "馬德里體育會", "Athletic Club": "畢爾包競技", Valencia: "華倫西亞", Villarreal: "維拉利爾",
  Juventus: "祖雲達斯", "AC Milan": "AC米蘭", Inter: "國際米蘭", Napoli: "拿玻里", Roma: "羅馬", Lazio: "拉素", Atalanta: "阿特蘭大",
  "Bayern Munich": "拜仁慕尼黑", Dortmund: "多蒙特", "Bayer Leverkusen": "利華古遜", "RB Leipzig": "RB萊比錫", Frankfurt: "法蘭克福",
  "Paris Saint Germain": "巴黎聖日耳門", Marseille: "馬賽", Lyon: "里昂", Monaco: "摩納哥", Lille: "里爾",
  "Bristol City": "布里斯托城", Millwall: "米爾沃",
  "Inter Miami": "國際邁阿密", "Inter Miami CF": "國際邁阿密", "Los Angeles FC": "洛杉磯FC", "LA Galaxy": "洛杉磯銀河", "Seattle Sounders": "西雅圖海灣者", "Portland Timbers": "波特蘭伐木者", "Orlando City SC": "奧蘭多城", "FC Cincinnati": "辛辛那提FC", "Chicago Fire": "芝加哥火焰",
  "Vissel Kobe": "神戶勝利船", "FC Tokyo": "FC東京", "Yokohama F. Marinos": "橫濱水手", "Urawa Reds": "浦和紅鑽", "Kashima Antlers": "鹿島鹿角", "Kawasaki Frontale": "川崎前鋒", "Gamba Osaka": "大阪飛腳", "Cerezo Osaka": "大阪櫻花", "Sanfrecce Hiroshima": "廣島三箭",
  "Jeju United FC": "濟州SK", "Jeju United": "濟州SK", "FC Anyang": "安養FC", "Ulsan HD FC": "蔚山HD", "Jeonbuk Hyundai Motors": "全北現代", "Pohang Steelers": "浦項製鐵", "FC Seoul": "FC首爾",
  "Melbourne Victory": "墨爾本勝利", "Melbourne City": "墨爾本城", "Sydney FC": "悉尼FC", "Western Sydney Wanderers": "西悉尼流浪者", "Central Coast Mariners": "中岸水手",
  "Shanghai Port": "上海海港", "Shanghai Shenhua": "上海申花", "Beijing Guoan": "北京國安", "Shandong Luneng": "山東泰山", "Chengdu Rongcheng": "成都蓉城", "Shenyang Urban": "瀋陽城市", "Sichuan Jiuniu": "四川九牛",
  Flamengo: "法林明高", Palmeiras: "彭美拉斯", Corinthians: "哥連泰斯", "Sao Paulo": "聖保羅", Fluminense: "富明尼斯", Cruzeiro: "高士路",
  "Club America": "墨西哥美洲", Guadalajara: "瓜達拉哈拉", "Guadalajara Chivas": "瓜達拉哈拉", "Cruz Azul": "藍十字", Monterrey: "蒙特雷", Tigres: "堤格雷斯", Tijuana: "提華納", "Club Tijuana": "提華納", Pachuca: "帕丘卡", "CF Pachuca": "帕丘卡",
};

const normalizedNames = new Map(Object.entries(TRADITIONAL_TEAM_NAMES).map(([english, chinese]) => [english.trim().toLocaleLowerCase(), chinese]));

export type TraditionalNameFields = {
  nameZhHk?: string | null;
  nameZhTw?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function selectTraditionalName(englishName: string, translation?: TraditionalNameFields): string | null {
  return nonEmpty(translation?.nameZhHk)
    ?? nonEmpty(translation?.nameZhTw)
    ?? normalizedNames.get(englishName.trim().toLocaleLowerCase())
    ?? null;
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
