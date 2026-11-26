"""Render the launch radar's three screenshots."""
import os, shutil, time
from io import BytesIO
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from PIL import Image

W, H = 1280, 900
root = os.path.dirname(os.path.abspath(__file__))
page = os.path.join(root, 'shot')
shutil.rmtree(page, ignore_errors=True)
os.makedirs(page)
for f in ('index.html', 'app.css', 'app.js'):
    shutil.copy(os.path.join(root, 'dashboard', f), os.path.join(page, f))
shutil.copy(os.path.join(root, 'out', 'data.js'), os.path.join(page, 'data.js'))

outdir = os.path.join(root, 'screenshots')
os.makedirs(outdir, exist_ok=True)

def grab(name, script=None, wait=0.6):
    o = Options()
    o.add_argument('--headless=new')
    o.add_argument('--hide-scrollbars')
    o.add_argument('--force-device-scale-factor=1')
    o.add_argument('--window-size=1280,1040')
    d = webdriver.Chrome(options=o)
    d.set_window_size(1280, 1040)
    d.get('file://' + os.path.join(page, 'index.html'))
    time.sleep(1.4)
    if script:
        d.execute_script(script)
        time.sleep(wait)
    d.execute_script("document.body.style.margin='0'")
    im = Image.open(BytesIO(d.get_screenshot_as_png())).convert('RGB').crop((0, 0, W, H))
    p = os.path.join(outdir, name)
    im.save(p, 'JPEG', quality=90, optimize=True)
    print(name, im.size, os.path.getsize(p))
    d.quit()

grab('1-board.jpg')
grab('2-detail.jpg', "document.querySelectorAll('.row')[6].click()")
grab('3-filtered.jpg', """(function(){
  var c=document.querySelectorAll('#catChips .chip');
  for(var i=0;i<c.length;i++){ if(c[i].dataset.cat && c[i].dataset.cat!=='all'){ c[i].click(); return; } }
})()""")
