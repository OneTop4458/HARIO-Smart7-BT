// Bean, grind and ice fields from the original Shared Recipes records.
// Descriptions paraphrase the author's notes or the stage table where the notes were blank.
const rudder = ['케냐 RUDDER BLEND 중강배전', 'Kenya RUDDER BLEND, medium-dark roast', 'ケニア RUDDER BLEND 中深煎り'];
const sidamo = ['에티오피아 시다모', 'Ethiopia Sidamo', 'エチオピア シダモ'];
const darkBlend = ['코스타리카 오리지널 다크 블렌드', 'Costa Rica Original Dark Blend', 'コスタリカ オリジナル ダークブレンド'];
const calibreGrinder = 'EK43 #8.6 · Comandante 26 clicks (zero)';

export const publicDetails = new Map([
  [1055, rudder, '굵게', 0, [
    '카스야 테츠의 4:6 방식을 적용한 다섯 번 붓기입니다. 첫 두 차례에 총 120mL를 사용합니다.',
    'A five-pour recipe based on Tetsu Kasuya’s 4:6 method. The first two pours use 120 mL in total.',
    '粕谷哲の4:6メソッドによる5投のレシピです。最初の2投で合計120mLを使います。']],
  [1069, sidamo, '중간보다 가늘게', 0, [
    '3잔 자동 모드를 바탕으로 물 온도를 낮추고 빠르게 부어 산미를 강조합니다.',
    'A three-cup Auto Mode variation with cooler water and quicker pours to highlight acidity.',
    '3杯のオートモードをもとに、低めの湯温と速めの注湯で酸味を引き出します。']],
  [1070, darkBlend, '중간보다 가늘게', 0, [
    '3잔 자동 모드를 바탕으로 물 온도를 높이고 느리게 부어 쓴맛을 강조합니다.',
    'A three-cup Auto Mode variation with hotter water and slower pours to emphasize bitterness.',
    '3杯のオートモードをもとに、高めの湯温とゆっくりした注湯で苦味を引き出します。']],
  [1072, darkBlend, '중간보다 가늘게', 0, [
    '기본 3잔 설정에서 원두량은 유지하고 물을 줄여 농도를 높인 레시피입니다.',
    'A stronger variation of the three-cup setting using less water with the same dose.',
    '3杯設定と同じ粉量で湯量を減らし、濃度を上げたレシピです。']],
  [1071, sidamo, '중간보다 가늘게', 0, [
    '기본 3잔 설정에서 원두량은 유지하고 물을 늘려 연하게 내리는 레시피입니다.',
    'A lighter variation of the three-cup setting using more water with the same dose.',
    '3杯設定と同じ粉量で湯量を増やし、軽く仕上げるレシピです。']],
  [1065, ['일본 森の実りブレンド', 'Japan, Forest Harvest Blend', '日本 森の実りブレンド'], '에스프레소용', 0, [
    '시티 로스트 후 약 2주 지난 원두로 내리는 레시피입니다. 게시물의 분쇄 항목에는 에스프레소용, 작성자 설명에는 중간보다 가늘게라고 적혀 있습니다.',
    'For beans about two weeks after a city roast. The grind field says espresso, and the author’s notes specify medium-fine.',
    'シティローストから約2週間の豆向けです。挽き目欄はエスプレッソ用で、投稿者の説明は中細挽きです。'], 'Mirukko 3.0–3.5'],
  [1197, ['에티오피아 Haro Soresa G1 내추럴', 'Ethiopia Haro Soresa G1 natural', 'エチオピア Haro Soresa G1 ナチュラル'], '중간', 0, [
    '하로 소레사 내추럴의 부드러운 산미를 즐기며 작성자가 공유한 네 번 붓기입니다.',
    'Four pours shared by the author, who noted the soft acidity of the Haro Soresa natural coffee.',
    'Haro Soresaのナチュラルの穏やかな酸味を好んだ投稿者による4投のレシピです。']],
  [1228, null, null, 0, [
    '30mL로 뜸을 들인 뒤 100mL, 90mL, 50mL를 차례대로 붓는 270mL 레시피입니다.',
    'A 270 mL recipe with a 30 mL bloom followed by 100, 90 and 50 mL pours.',
    '30mLで蒸らし、100、90、50mLと続ける合計270mLのレシピです。']],
  [1061, rudder, '가늘게', 40, [
    '카스야 테츠의 아이스 4:6 레시피입니다. 가늘게 분쇄한 원두 35g과 추출수 300mL를 기준으로 합니다.',
    'Tetsu Kasuya’s iced 4:6 recipe uses 35 g of finely ground coffee and 300 mL of brew water.',
    '粕谷哲のアイス向け4:6レシピです。細挽き35gと抽出湯量300mLが基準です。']],
  [1257, ['에콰도르 라스 아구아코라스 · 티피카 워시드', 'Ecuador Las Aguacoras, washed Typica', 'エクアドル ラス・アグアコラス ティピカ ウォッシュド'], '중간보다 가늘게', 0, [
    '모모스커피가 에콰도르 로하의 타자 도라다 2위 원두를 사용했습니다. 오렌지 향과 사탕수수 같은 단맛을 소개합니다.',
    'Momos Coffee used the Taza Dorada runner-up from Loja, Ecuador, and noted orange and sugarcane sweetness.',
    'モモスコーヒーがエクアドル・ロハのタサ・ドラダ2位の豆を使用し、オレンジの香りとサトウキビの甘みを紹介しています。']],
  [1277, ['에티오피아 게이샤 테피 G2 워시드', 'Ethiopia Geisha Tepi G2 washed', 'エチオピア ゲイシャ テピ G2 ウォッシュド'], '에스프레소용', 0, [
    '80°C의 물에 원두 50g을 사용하는 레시피입니다. 작성자는 추출 도구를 예열하고 뜸부터 고르게 적셨다고 설명합니다.',
    'A low-temperature recipe using 50 g at 80°C. The author preheated the equipment and stirred during the bloom to wet the grounds evenly.',
    '80°Cの湯と粉50gを使います。投稿者は器具の予熱と、蒸らしで粉を均一に濡らすための撹拌を紹介しています。']],
  [1283, ['니카라과 할라파 Mountain Cajarural', 'Nicaragua Jalapa Mountain Cajarural', 'ニカラグア ハラパ Mountain Cajarural'], '중간', 100, [
    '원두 사이에 얼그레이 2g을 더한 아이스 푸어오버로, 차와 커피를 함께 우린 레시피입니다.',
    'An iced pour-over that brews the coffee together with 2 g of Earl Grey tea layered among the grounds.',
    '粉の間にアールグレイ2gを重ね、コーヒーと一緒に抽出するアイスレシピです。']],
  [1287, null, null, 0, [
    '30mL로 뜸을 들인 뒤 100mL, 70mL, 70mL를 나눠 붓는 270mL 레시피입니다.',
    'A 270 mL recipe with a 30 mL bloom followed by 100, 70 and 70 mL pours.',
    '30mLで蒸らし、100、70、70mLと注ぐ合計270mLのレシピです。']],
  [1321, ['인도네시아 허니 프로세스 · 중약~중배전', 'Indonesian honey-processed coffee, medium-light to medium', 'インドネシア ハニープロセス 中浅〜中煎り'], '중간', 0, [
    '중약~중배전 허니 프로세스 원두용입니다. 작성자는 물을 부을 때마다 드리퍼를 돌려 원두를 고르게 적셨습니다.',
    'For medium-light to medium honey-processed coffee. The author swirled the dripper on each pour for even saturation.',
    '中浅〜中煎りのハニープロセス向けです。投稿者は注湯ごとにドリッパーを回し、粉を均等に濡らしました。'], calibreGrinder],
  [1323, ['인도네시아 워시드·웻헐·허니 프로세스 · 중약~중배전', 'Indonesian washed, wet-hulled or honey, medium-light to medium', 'インドネシア ウォッシュド・ウェットハル・ハニー 中浅〜中煎り'], '중간', 250, [
    '280mL를 다섯 번에 나눠 붓는 아이스 레시피입니다. 작성자는 매번 드리퍼를 돌려 원두를 고르게 적셨습니다.',
    'An iced recipe using five pours totaling 280 mL. The author swirled the dripper at each pour to wet the grounds evenly.',
    '5投で合計280mLを使うアイスレシピです。投稿者は注湯ごとにドリッパーを回して粉を均等に濡らしました。'], calibreGrinder],
  [1330, ['에티오피아 코체레 내추럴', 'Ethiopia Kochere natural', 'エチオピア コチャレ ナチュラル'], '중간', 0, [
    '코체레 내추럴 원두의 단맛과 긴 여운을 살리도록 구성한 네 번 붓기입니다.',
    'Four pours designed to bring out the sweetness and lingering finish of Kochere natural coffee.',
    'コチャレのナチュラルの甘みと長い余韻を引き出す4投のレシピです。']],
  [1334, ['오시게 블렌딩 · 브라질 50%, 에티오피아 30%, 엘살바도르 20%', 'Osige Blend · Brazil 50%, Ethiopia 30%, El Salvador 20%', 'オシゲブレンド · ブラジル50%、エチオピア30%、エルサルバドル20%'], '중간', 0, [
    '모모스커피가 칼리타 웨이브 185를 사용했습니다. 크리미한 질감과 고소한 단맛, 은은한 베리 향을 소개합니다.',
    'Momos Coffee used a Kalita Wave 185 and noted a creamy mouthfeel, nutty sweetness and subtle berry aroma.',
    'モモスコーヒーがカリタ ウェーブ185を使用し、クリーミーな口当たりとナッツの甘み、ほのかなベリーを紹介しています。']],
  [1633, null, null, 0, [
    '70mL로 뜸을 들이고 150mL부터 60mL까지 한 번에 붓는 물을 점차 줄입니다.',
    'A 70 mL bloom followed by pours that gradually decrease from 150 mL to 60 mL.',
    '70mLで蒸らした後、1投の量を150mLから60mLまで段階的に減らします。']],
  [1715, ['한국 · 게시물 원두명 ‘테스트’', 'Korea · bean field reads “Test”', '韓国 · 豆名欄は「テスト」'], '중간', 0, [
    '40mL로 뜸을 들인 다음 120mL씩 두 번에 나눠 붓습니다.',
    'A 40 mL bloom followed by two 120 mL pours.',
    '40mLで蒸らし、120mLずつ2回に分けて注湯します。']]
].map(([id, beans, grind, ice, description, grinder]) => [id, { beans, grind, ice, description, grinder }]));

const pourOverPhoto = {
  file: './reference-v60.jpg',
  author: 'GorillaWarfare',
  source: 'https://commons.wikimedia.org/wiki/File:Coffee_pour_over_using_Hario_cone.jpg',
  license: 'CC BY-SA 1.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/1.0/'
};

const cupPhoto = {
  file: './reference-cup.jpg',
  author: 'Martin Falbisoner',
  source: 'https://commons.wikimedia.org/wiki/File:Cup_and_coffee_beans.JPG',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
};

const icedPhoto = {
  file: './reference-iced.jpg',
  author: 'roland',
  source: 'https://commons.wikimedia.org/wiki/File:Iced_cold_brew_coffee.jpg',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
};

export function recipePhoto(id) {
  if (publicDetails.get(id).ice) return icedPhoto;
  return id >= 1069 && id <= 1072 ? cupPhoto : pourOverPhoto;
}
