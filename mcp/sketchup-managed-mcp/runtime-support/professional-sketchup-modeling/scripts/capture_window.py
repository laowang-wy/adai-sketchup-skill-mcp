"""Non-activating HWND capture. Parent MCP owns timeouts and finally restoration."""
import ctypes as c
from ctypes import wintypes as w
import json,sys,time,os
from pathlib import Path
from PIL import Image,ImageStat
u=c.windll.user32;g=c.windll.gdi32
try:u.SetProcessDpiAwarenessContext(c.c_void_p(-4))
except (AttributeError,OSError):pass
u.GetForegroundWindow.restype=w.HWND
u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
u.GetWindowRect.argtypes=[w.HWND,c.POINTER(w.RECT)]
u.ShowWindow.argtypes=[w.HWND,c.c_int]
u.SetWindowPos.argtypes=[w.HWND,w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.UINT]
u.IsIconic.argtypes=[w.HWND];u.IsWindow.argtypes=[w.HWND];u.IsWindowEnabled.argtypes=[w.HWND]
u.GetDC.restype=w.HDC;u.GetDC.argtypes=[w.HWND]
u.PrintWindow.argtypes=[w.HWND,w.HDC,w.UINT]
u.ReleaseDC.argtypes=[w.HWND,w.HDC]
g.CreateCompatibleDC.restype=w.HDC;g.CreateCompatibleDC.argtypes=[w.HDC]
g.CreateCompatibleBitmap.restype=w.HBITMAP;g.CreateCompatibleBitmap.argtypes=[w.HDC,c.c_int,c.c_int]
g.SelectObject.restype=w.HANDLE;g.SelectObject.argtypes=[w.HDC,w.HANDLE]
g.GetDIBits.argtypes=[w.HDC,w.HBITMAP,w.UINT,w.UINT,c.c_void_p,c.c_void_p,w.UINT]
g.DeleteObject.argtypes=[w.HANDLE];g.DeleteDC.argtypes=[w.HDC]
CB=c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
class Header(c.Structure):
 _fields_=[('size',w.DWORD),('width',w.LONG),('height',w.LONG),('planes',w.WORD),('bits',w.WORD),('compression',w.DWORD),('image_size',w.DWORD),('x',w.LONG),('y',w.LONG),('used',w.DWORD),('important',w.DWORD)]
def rect(h):
 r=w.RECT()
 if not u.GetWindowRect(h,c.byref(r)):raise RuntimeError('Window rectangle unavailable')
 return [r.left,r.top,r.right,r.bottom]
def pid(h):
 p=w.DWORD();u.GetWindowThreadProcessId(h,c.byref(p));return p.value
def cursor():
 p=w.POINT();u.GetCursorPos(c.byref(p));return [p.x,p.y]
def main():
 output=Path(sys.argv[1]);expected=int(sys.argv[2]);state_path=output.parent/'capture-window-state.json'
 if '--restore' in sys.argv:
  if not state_path.exists():return {'ok':True,'restoration':'nothing_prepared'}
  state=json.loads(state_path.read_text());h=state['hwnd']
  if not u.IsWindow(h) or pid(h)!=expected:raise RuntimeError('Prepared window no longer exists; cannot restore')
  if state['was_minimized'] and not u.IsIconic(h):u.ShowWindow(h,7) # SW_SHOWMINNOACTIVE
  return {'ok':True,'restoration':'complete','is_minimized':bool(u.IsIconic(h))}
 windows=[]
 @CB
 def top(h,l):
  if pid(h)==expected and u.IsWindowVisible(h):
   s=c.create_unicode_buffer(1024);u.GetWindowTextW(h,s,1024)
   if 'SketchUp Pro' in s.value:windows.append((h,s.value))
  return True
 u.EnumWindows(top,0)
 if len(windows)!=1:raise RuntimeError('Expected one visible modeling window for bridge PID')
 h,title=windows[0]
 if not u.IsWindowEnabled(h):raise RuntimeError('SketchUp modal active; capture paused')
 fg=u.GetForegroundWindow();before=cursor()
 if '--prepare' in sys.argv:
  output.parent.mkdir(parents=True,exist_ok=True)
  state={'hwnd':h,'pid':expected,'was_minimized':bool(u.IsIconic(h)),'foreground_before':fg,'cursor_before':before,'window_rect_before':rect(h)}
  state_path.write_text(json.dumps(state),encoding='utf8')
  if state['was_minimized']:
   u.ShowWindow(h,4) # SW_SHOWNOACTIVATE: restore without focus
   u.SetWindowPos(h,1,0,0,0,0,0x0013) # bottom, NOSIZE|NOMOVE|NOACTIVATE
   time.sleep(0.6)
  if u.IsIconic(h):raise RuntimeError('Window remains minimized; no foreground fallback')
  return {'ok':True,'backend':'window_print','process_id':expected,'foreground_unchanged':fg==u.GetForegroundWindow(),'cursor_before':before,'cursor_after':cursor(),'window_rect':rect(h),'state_path':str(state_path)}
 if u.IsIconic(h):raise RuntimeError('Window minimized during capture; retry evidence, no automatic activation')
 wr=rect(h);width=wr[2]-wr[0];height=wr[3]-wr[1]
 if width<400 or height<300 or width*height>40000000:raise RuntimeError('Invalid capture dimensions')
 children=[]
 @CB
 def child(ch,l):
  cl=c.create_unicode_buffer(256);u.GetClassNameW(ch,cl,256)
  if 'FrameOrView' in cl.value and u.IsWindowVisible(ch):
   r=rect(ch)
   if r[2]-r[0]>300 and r[3]-r[1]>200:children.append((ch,r))
  return True
 u.EnumChildWindows(h,child,0)
 if len(children)!=1:raise RuntimeError('Ambiguous model viewport')
 ch,vr=children[0];box=(vr[0]-wr[0],vr[1]-wr[1],vr[2]-wr[0],vr[3]-wr[1])
 if box[0]<0 or box[1]<0 or box[2]>width or box[3]>height:raise RuntimeError('Viewport outside captured window')
 dc=mem=bmp=old=None
 try:
  dc=u.GetDC(h);mem=g.CreateCompatibleDC(dc);bmp=g.CreateCompatibleBitmap(dc,width,height)
  if not dc or not mem or not bmp:raise RuntimeError('GDI allocation failed')
  old=g.SelectObject(mem,bmp)
  if not u.PrintWindow(h,mem,2):raise RuntimeError('PrintWindow failed; no desktop fallback')
  g.SelectObject(mem,old);old=None
  header=Header(c.sizeof(Header),width,-height,1,32,0,0,0,0,0,0);buf=c.create_string_buffer(width*height*4)
  if g.GetDIBits(mem,bmp,0,height,buf,c.byref(header),0)!=height:raise RuntimeError('Incomplete window bitmap')
  image=Image.frombytes('RGB',(width,height),buf.raw,'raw','BGRX').crop(box)
  if max(ImageStat.Stat(image).stddev)<1.0:raise RuntimeError('Blank window capture; refusing evidence')
  if rect(h)!=wr or rect(ch)!=vr or u.IsIconic(h) or not u.IsWindowEnabled(h):raise RuntimeError('Window changed during capture')
  image.save(output)
  return {'ok':True,'backend':'window_print','process_id':expected,'window':title,'window_rect':wr,'viewport_rect':vr,'image_size':image.size,'foreground_unchanged':fg==u.GetForegroundWindow(),'cursor_before':before,'cursor_after':cursor(),'capture_api':'PrintWindow(PW_RENDERFULLCONTENT)','foreground_required':False}
 finally:
  if old:g.SelectObject(mem,old)
  if bmp:g.DeleteObject(bmp)
  if mem:g.DeleteDC(mem)
  if dc:u.ReleaseDC(h,dc)
if __name__=='__main__':print(json.dumps(main(),ensure_ascii=True))
