docker build -t dailynotestest:latest . && \
docker save dailynotestest:latest | ssh -i /home/luka/.ssh/docker root@dockergw.homelab.puhek.si 'docker load' && \
ssh -i /home/luka/.ssh/docker root@dockergw.homelab.puhek.si 'cd /home/docker/dailyNotesTesting && docker compose up -d --force-recreate'