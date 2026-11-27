import numpy as np, json, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
d=np.fromfile('splats.bin',dtype=np.float32).reshape(-1,16).astype(np.float64)
P=d[:,:3]; C=np.zeros((len(d),3,3))
C[:,0,0]=d[:,4];C[:,0,1]=C[:,1,0]=d[:,5];C[:,0,2]=C[:,2,0]=d[:,6]
C[:,1,1]=d[:,8];C[:,1,2]=C[:,2,1]=d[:,9];C[:,2,2]=d[:,10]
rgbi=d[:,7].astype(np.int64); col=np.stack([rgbi&255,(rgbi>>8)&255,(rgbi>>16)&255],1)/255
yaw,pitch,dist,tgt=0.6,0.28,9,np.array([0,1.3,0])
s,c,cp=np.sin(yaw),np.cos(yaw),np.cos(pitch)
back=np.array([cp*s,np.sin(pitch),cp*c]); right=np.array([c,0,-s]); up=np.cross(back,right)
eye=tgt+dist*back
N=600; f=N*1.9
v=P-eye; z=-(v@back); x=v@right; y=v@up
u=N/2+f*x/z; w=N*0.58-f*y/z
J=np.stack([right,-up],0)  # 2x3
S2=(f/z)[:,None,None]**2*np.einsum('ij,njk,lk->nil',J,C,J)+np.eye(2)*0.35
# normals: eigenvector of smallest eigenvalue, facing camera
ev,evec=np.linalg.eigh(C); nrm=evec[:,:,0]; flip=(nrm@back)<0; nrm[flip]*=-1
rng=np.random.default_rng(3); rand=rng.uniform(0.25,1,(len(d),3))
order=np.argsort(-z)  # far to near
def splat(colors,bg=(0.043,0.051,0.078),op=0.95):
    img=np.ones((N,N,3))*bg
    for i in order:
        Si=np.linalg.inv(S2[i]); r=int(3*np.sqrt(S2[i].max()))+1
        x0,x1=max(int(u[i])-r,0),min(int(u[i])+r+1,N); y0,y1=max(int(w[i])-r,0),min(int(w[i])+r+1,N)
        if x0>=x1 or y0>=y1: continue
        X,Y=np.meshgrid(np.arange(x0,x1)+.5-u[i],np.arange(y0,y1)+.5-w[i])
        a=op*np.exp(-0.5*(Si[0,0]*X*X+2*Si[0,1]*X*Y+Si[1,1]*Y*Y))[...,None]
        img[y0:y1,x0:x1]=img[y0:y1,x0:x1]*(1-a)+colors[i]*a
    return np.clip(img,0,1)
pts=np.ones((N,N,3))*np.array([0.043,0.051,0.078])
ok=(u>=0)&(u<N)&(w>=0)&(w<N)
for i in order[ok[order]]:
    pts[int(w[i]),int(u[i])]=np.array([1,1,1])*np.clip(1.6-0.12*z[i],0.3,1)
rand_img=splat(rand); nrm_img=splat(nrm*0.5+0.5); lit_img=splat(col)
sd=json.load(open('sdf.json')); g=np.array(sd['sdf']).reshape(sd['H'],sd['W'])
p=json.load(open('passes.json')); final=np.array(p['rgb']).reshape(p['h'],p['w'],3)/255
fig,ax=plt.subplots(2,3,figsize=(15,10.6),facecolor='#0b0d14')
ext=[*sd['xs'],*sd['ys']]
ax[0,0].imshow(np.clip(g,-1,1),cmap='RdBu',vmin=-1,vmax=1,extent=ext)
ax[0,0].contour(np.flipud(g),levels=[0],colors='k',linewidths=2,extent=ext)
ax[0,0].contour(np.flipud(g),levels=np.arange(-1,1.01,0.2),colors='k',linewidths=0.4,alpha=0.5,extent=ext)
panels=[(ax[0,0],None,'1. SDF (vertical slice)\nred = inside, blue = outside, black = surface'),
 (ax[0,1],pts,'2. Bake: points snapped to surface\n%d splat centres'%len(d)),
 (ax[0,2],rand_img,'3. Each point becomes a flat Gaussian\n(random colour per splat)'),
 (ax[1,0],nrm_img,'4. Surface normals per splat\n(geometry, before lighting)'),
 (ax[1,1],lit_img,'5. Lit + palette-snapped at bake,\nsmooth splats, before pixel grid'),
 (ax[1,2],final,'6. Final: rendered to %dx%d art pixels'%(p['w'],p['h']))]
for a,im,t in panels:
    if im is not None: a.imshow(im,interpolation='nearest')
    if a is not ax[0,0]: a.set_xlim(70,530); a.set_ylim(560,100) if im is not final else None
    a.set_title(t,color='w',fontsize=12); a.axis('off')
ax[1,2].set_xlim(15,114); ax[1,2].set_ylim(80,8)
plt.tight_layout(); plt.savefig('pipeline.png',dpi=110,facecolor='#0b0d14')
