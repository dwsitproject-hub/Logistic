#!/usr/bin/env bash
#
# MOVED. Production is two hosts, and each now has its own script:
#
#   backend   (ECS-DB)   cd /opt/klip && bash docs/scripts/deploy-prod-backend.sh
#   frontend  (ECS-App)  cd /opt/klip && bash docs/scripts/deploy-prod-frontend.sh
#
# This stub deploys nothing. It stays so that an old habit (`deploy-prod.sh backend`) ends in a
# message that names the right file instead of "No such file".

printf '\n  deploy-prod.sh was split into one script per host:\n\n'
printf '    backend  (ECS-DB)  : bash docs/scripts/deploy-prod-backend.sh\n'
printf '    frontend (ECS-App) : bash docs/scripts/deploy-prod-frontend.sh\n\n'
case "${1:-}" in
  backend)  printf '  You asked for: backend  -> run deploy-prod-backend.sh\n\n' ;;
  frontend) printf '  You asked for: frontend -> run deploy-prod-frontend.sh\n\n' ;;
esac
exit 1
