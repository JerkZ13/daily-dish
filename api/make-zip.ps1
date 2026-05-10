$tmp = [System.IO.Path]::GetTempPath() + "scf-deploy"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Copy-Item "C:\Users\munek\Desktop\daily-dish\api\scf-news.js" "$tmp\index.js" -Force
Copy-Item "C:\Users\munek\Desktop\daily-dish\api\scf_bootstrap" "$tmp\scf_bootstrap" -Force
Compress-Archive -Path "$tmp\index.js", "$tmp\scf_bootstrap" -DestinationPath "C:\Users\munek\Desktop\daily-dish\api\scf-news.zip" -Force
Remove-Item $tmp -Recurse -Force
Write-Output "OK: scf-news.zip created"
