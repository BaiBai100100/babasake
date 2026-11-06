// CPUキャラ。呼んだ順に登場する。lines はお題で指名されたときなどのひとこと。
export const CPUS = [
  { key: 'zaruko', name: 'ザル子', img: 'cpu-zaruko', lines: ['まだ序盤でしょ？', 'はい次ー！', 'その程度で酔うわけないじゃん', 'おかわり頼んどいて'] },
  { key: 'senpai', name: 'ほろよい先輩', img: 'cpu-senpai', lines: ['いや〜まいったなあ！', '先輩にまかせなさい', 'ネクタイ巻いていい？', '若いっていいねえ'] },
  { key: 'geko', name: 'ゲコ田', img: 'cpu-geko', lines: ['ぼく烏龍茶で…', 'ゲコッ…（汗）', 'お水もらっていいですか', 'え、ぼくですか!?'] },
  { key: 'robo', name: '乾杯ロボ', img: 'cpu-robo', lines: ['カンパイ、ヲ、ジッコウシマス', 'ピピッ…照れ機能が作動', 'アルコール、検知デキマセン', 'タノシイ、ヲ、学習中'] },
  { key: 'neko', name: 'ネコ店長', img: 'cpu-neko', lines: ['うちの店で酔いつぶれないでにゃ', 'サービスしとくにゃ', 'にゃるほど', 'お会計はあとでにゃ'] },
  { key: 'gal', name: 'ギャル姫', img: 'cpu-gal', lines: ['え、アガるんだけど！', 'ぴえん…でもやる', '写真撮っとこ〜', 'それな！！'] },
];
export const CPU_BY_KEY = Object.fromEntries(CPUS.map((c) => [c.key, c]));

// みんなの画面で同じひとことが出るよう、番号から決める
export function cpuLine(key, n = 0) {
  const c = CPU_BY_KEY[key];
  if (!c) return '';
  return c.lines[Math.abs(n) % c.lines.length];
}
