s=open('v8-src.html').read()
for k,f in [('D3','../lib/d3.min.js'),('DAG','../lib/d3-dag.min.js'),('DATA','../lib/v8-data.js'),('EHRTSlib','../lib/ehrtslib-browser.min.js')]:
    needle='<script>/*%s*/</script>'%k
    assert needle in s, needle
    s=s.replace(needle,'<script>'+open(f).read()+'</script>')
open('../v8-multilingual-stack-demo.html','w').write(s)
print('wrote v8-multilingual-stack-demo.html', len(s))
