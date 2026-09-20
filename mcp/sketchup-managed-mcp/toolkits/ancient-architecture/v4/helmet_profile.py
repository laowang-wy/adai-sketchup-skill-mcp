"""Versioned, explicitly inferred source-informed meridian with C1 monotone slopes."""
from pathlib import Path
import json,hashlib
PATH=Path(__file__).resolve().parents[1]/'study/helmet-source/profile.json'
RAW=PATH.read_bytes()
if hashlib.sha256(RAW).hexdigest()!='5332da8d5e61a4130daa8fcbac133b89243b26ecfaf565d23350e9c6d3e845ac':raise ValueError('HELMET_PROFILE_HASH_MISMATCH')
DATA=json.loads(RAW);STATIONS=DATA['stations']
H=[b[0]-a[0] for a,b in zip(STATIONS,STATIONS[1:])]
D=[(b[1]-a[1])/h for a,b,h in zip(STATIONS,STATIONS[1:],H)]
SLOPES=[0.]
for i in range(1,len(STATIONS)-1):
 w1=2*H[i]+H[i-1];w2=H[i]+2*H[i-1];SLOPES.append((w1+w2)/(w1/D[i-1]+w2/D[i]))
SLOPES.append(0.)
def value(t):
 t=max(0,min(1,t))
 for i,((x,a),(y,b)) in enumerate(zip(STATIONS,STATIONS[1:])):
  if t<=y:
   q=(t-x)/(y-x);return (2*q**3-3*q*q+1)*a+(q**3-2*q*q+q)*H[i]*SLOPES[i]+(-2*q**3+3*q*q)*b+(q**3-q*q)*H[i]*SLOPES[i+1]
 return 1.
