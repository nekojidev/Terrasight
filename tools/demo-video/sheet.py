import subprocess,os,sys
F="/opt/homebrew/bin/ffmpeg"
d=sys.argv[1]; pre=sys.argv[2]; per=int(sys.argv[3]) if len(sys.argv)>3 else 9
files=sorted(f for f in os.listdir(d) if f.startswith(pre))
for k in range(0,len(files),per):
    g=files[k:k+per]
    ins=[x for f in g for x in ("-i",os.path.join(d,f))]
    fc="".join(f"[{i}]scale=640:360[v{i}];" for i in range(len(g)))
    lay="|".join(f"{(i%3)*640}_{(i//3)*360}" for i in range(len(g)))
    fc+="".join(f"[v{i}]" for i in range(len(g)))+f"xstack=inputs={len(g)}:layout={lay}[o]"
    subprocess.run([F,"-y","-v","error",*ins,"-filter_complex",fc,"-map","[o]","-frames:v","1",os.path.join(d,f"cs-{k//per}.png")],check=True)
print(len(files))
