// TAM THOI (05/08/2026): script dieu tra - xoa sau khi fix xong FPT/Focus Model.
// Muc dich: commit + push 1 file debug len git ma KHONG phu thuoc shell cua
// runner (pwsh tren Windows hay coi stderr binh thuong cua git la loi
// terminating; bash co the khong co trong PATH tren self-hosted). Goi git
// truc tiep bang child_process, tu Node - luon nhat quan bat ke shell nao.
const { execSync } = require('child_process');

const file = process.argv[2];
const fs = require('fs');

if (!file || !fs.existsSync(file)) {
  console.log(`[push-debug-file] "${file}" khong ton tai - bo qua.`);
  process.exit(0);
}

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`$ ${cmd}\n${out}`);
    return true;
  } catch (e) {
    console.log(`$ ${cmd}\n(exit ${e.status}) ${e.stdout || ''} ${e.stderr || ''}`);
    return false;
  }
}

run('git config user.name "msi-data-bot"');
run('git config user.email "actions@users.noreply.github.com"');
run(`git add ${file}`);
const committed = run(`git commit -m "chore(debug): log dieu tra FPT it SP [skip ci]"`);
if (!committed) {
  console.log('[push-debug-file] Khong co gi moi de commit - bo qua push.');
  process.exit(0);
}
run('git pull --rebase origin main');
run('git push origin HEAD:main');
console.log('[push-debug-file] Done.');
