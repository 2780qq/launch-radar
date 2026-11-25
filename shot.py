"""Render the dashboard's three screenshots from the generated data."""
import json, os, shutil, sys, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

W, H = 1440, 1000
root = os.path.dirname(os.path.abspath(__file__))
page = os.path.join(root, 'shot')       # a self-contained copy the browser can open from file://
shutil.rmtree(page, ignore_errors=True)
os.makedirs(page, exist_ok=True)
for f in ('index.html', 'app.css', 'app.js'):
    shutil.copy(os.path.join(root, 'dashboard', f), os.path.join(page, f))
shutil.copy(os.path.join(root, 'out', 'data.js'), os.path.join(page, 'data.js'))

o = Options()
o.add_argument('--headless=new')
o.add_argument('--hide-scrollbars')
o.add_argument('--force-device-scale-factor=1')
o.add_argument(f'--window-size={W},{H}')
d = webdriver.Chrome(options=o)
d.set_window_size(W, H)
url = 'file://' + os.path.join(page, 'index.html')
d.get(url)
time.sleep(1.2)

outdir = os.path.join(root, 'screenshots')
os.makedirs(outdir, exist_ok=True)

def shot(name):
    p = os.path.join(outdir, name)
    d.save_screenshot(p)
    print(name, os.path.getsize(p), 'bytes')

# 1. the board, with the top row's detail open
d.execute_script("document.querySelectorAll('.row')[0].click()")
time.sleep(0.6)
d.execute_script("window.scrollTo(0,0)")
time.sleep(0.2)
shot('1-board.png')

# 2. a protocol detail view: pick a high-value watchlist protocol
rows = d.find_elements(By.CSS_SELECTOR, '.row')
target = None
for r in rows:
    if 'OnRe' in r.text or 'OpenTrade' in r.text:
        target = r
        break
(target or rows[6]).click()
time.sleep(0.6)
d.execute_script("document.querySelector('.detail').scrollIntoView({block:'start'})")
time.sleep(0.3)
shot('2-detail.png')

# 3. a filtered view: a single category, sorted by implied value
d.execute_script("""
(function(){
  var chips = document.querySelectorAll('#catChips .chip');
  for (var i=0;i<chips.length;i++){ if (chips[i].dataset.cat && chips[i].dataset.cat !== 'all'){ chips[i].click(); return; } }
})();
""")
time.sleep(0.6)
d.execute_script("window.scrollTo(0,0)")
time.sleep(0.3)
shot('3-filtered.png')

d.quit()
