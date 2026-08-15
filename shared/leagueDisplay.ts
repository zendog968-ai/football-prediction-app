const LEAGUE_NAMES: Record<string, string> = {
  "Premier League": "英超", "Championship": "英冠", "League One": "英甲", "League Two": "英乙", "National League": "英格蘭全國聯",
  "La Liga": "西甲", "Segunda Division": "西乙", "Copa del Rey": "西班牙盃",
  "Serie A": "意甲", "Serie B": "意乙", "Coppa Italia": "意大利盃",
  "Bundesliga": "德甲", "2. Bundesliga": "德乙", "DFB Pokal": "德國盃",
  "Ligue 1": "法甲", "Ligue 2": "法乙", "Eredivisie": "荷甲", "Eerste Divisie": "荷乙",
  "Primeira Liga": "葡超", "Liga Portugal 2": "葡甲", "Pro League": "職業聯賽",
  "Scottish Premiership": "蘇超", "Super League": "中超", "Allsvenskan": "瑞典超", "Superettan": "瑞典甲",
  "Eliteserien": "挪威超", "1. Division": "挪威甲", "Veikkausliiga": "芬蘭超", "Ykkonen": "芬蘭甲",
  "Ekstraklasa": "波蘭超", "Superliga": "丹麥超", "Czech Liga": "捷克甲", "Super League 1": "希臘超",
  "Swiss Super League": "瑞士超", "Süper Lig": "土超", "2. Liga": "奧乙",
  "Liga Profesional Argentina": "阿甲", "Primera Nacional": "阿乙", "Serie A Brazil": "巴甲", "Serie B Brazil": "巴乙",
  "Major League Soccer": "美職聯", "USL Championship": "美冠聯", "Liga MX": "墨超",
  "J1 League": "日聯", "J2 League": "日乙", "J3 League": "日丙", "K League 1": "K1聯賽", "K League 2": "K2聯賽",
  "A-League": "澳職聯", "Victoria NPL": "澳維超", "New South Wales NPL": "澳新南威超",
  "AFC Champions League": "亞冠聯賽", "AFC Champions League 2": "亞冠2", "CONMEBOL Libertadores": "南美自由盃", "CONMEBOL Sudamericana": "南美球會盃",
  "UEFA Champions League": "歐聯", "UEFA Europa League": "歐霸", "UEFA Conference League": "歐協聯",
};

const COUNTRY_NAMES: Record<string, string> = {
  England: "英格蘭", Spain: "西班牙", Italy: "意大利", Germany: "德國", France: "法國", Netherlands: "荷蘭", Portugal: "葡萄牙", Belgium: "比利時", Austria: "奧地利", Scotland: "蘇格蘭", Turkey: "土耳其", Greece: "希臘", Denmark: "丹麥", Norway: "挪威", Sweden: "瑞典", Finland: "芬蘭", Poland: "波蘭", "Czech-Republic": "捷克", Switzerland: "瑞士", Argentina: "阿根廷", Brazil: "巴西", USA: "美國", Mexico: "墨西哥", Japan: "日本", "South-Korea": "南韓", China: "中國", Australia: "澳洲", "Saudi-Arabia": "沙特阿拉伯", "United-Arab-Emirates": "阿聯酋", Qatar: "卡塔爾", World: "國際賽",
};

const COUNTRY_LEAGUE_NAMES: Record<string, string> = {
  "brazil::serie a": "巴甲", "brazil::serie b": "巴乙",
  "italy::serie a": "意甲", "italy::serie b": "意乙",
  "argentina::liga profesional argentina": "阿甲", "argentina::primera nacional": "阿乙",
  "mexico::liga mx": "墨超", "japan::j1 league": "日聯", "japan::j2 league": "日乙", "japan::j3 league": "日丙",
  "south-korea::k league 1": "K1聯賽", "south-korea::k league 2": "K2聯賽",
  "australia::a-league": "澳職聯", "australia::victoria npl": "澳維超", "australia::new south wales npl": "澳新南威超",
  "united-arab-emirates::pro league": "阿聯酋超", "saudi-arabia::pro league": "沙特超",
  "austria::bundesliga": "奧甲", "germany::bundesliga": "德甲",
};

function normalizeCountry(value: string): string {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function parseLeagueIdentity(value: string, country?: string | null): { leagueName: string; country: string | null } {
  const raw = value.trim();
  const delimiter = raw.indexOf("::");
  if (delimiter > 0) return { country: raw.slice(0, delimiter).trim(), leagueName: raw.slice(delimiter + 2).trim() };
  return { leagueName: raw, country: country?.trim() || null };
}

/** Retains country alongside the provider's raw name for ambiguous competitions such as Serie A. */
export function encodeLeagueIdentity(englishName: string, country?: string | null): string {
  const league = englishName.trim();
  const nation = country?.trim();
  return league && nation ? `${nation}::${league}` : league;
}

export function localizeLeagueName(englishName: string, country?: string | null): string {
  const { leagueName: original, country: resolvedCountry } = parseLeagueIdentity(englishName, country);
  if (!original) return "未知聯賽";
  const countryKey = resolvedCountry ? normalizeCountry(resolvedCountry) : null;
  const countryLeague = countryKey ? COUNTRY_LEAGUE_NAMES[`${countryKey}::${original.toLowerCase()}`] : null;
  if (countryLeague) return countryLeague;
  const direct = LEAGUE_NAMES[original];
  if (direct) {
    if (original === "Bundesliga" && resolvedCountry === "Austria") return "奧甲";
    if (original === "Pro League" && resolvedCountry === "United-Arab-Emirates") return "阿聯酋超";
    if (original === "Pro League" && resolvedCountry === "Saudi-Arabia") return "沙特超";
    return direct;
  }
  const localizedCountry = resolvedCountry ? COUNTRY_NAMES[resolvedCountry] : null;
  return localizedCountry ? `${localizedCountry}｜${original}` : original;
}

export function formatLeagueDisplay(englishName: string, country?: string | null): string {
  const { leagueName } = parseLeagueIdentity(englishName, country);
  const traditional = localizeLeagueName(englishName, country);
  return traditional === leagueName ? traditional : `${traditional} (${leagueName})`;
}
