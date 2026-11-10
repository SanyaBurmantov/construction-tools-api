#!/bin/sh
# One entry point for every prod step of /claude-edit-products, so a single
# permission rule covers them. Password: PROD_SSH_PASS (user settings env, never
# the repo) or an SSH key.
#   cep.sh export N ROOT SEED OUT.json   read-only: N random products (ROOT '' = all)
#   cep.sh check CARDS.json TEXTS.json   read-only: site checks + detector → stdout JSON
#   cep.sh apply TEXTS.json              writes the descriptions (admin PATCH)
#   cep.sh mark TEXTS.json               marks them AI-written (aiLockedFields)
#   cep.sh cleanup                       removes /tmp/cep-* on the host and in the containers
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
P="$DIR/prod.sh"
up() { cat "$1" | "$P" "cat > /tmp/$2 && docker cp -q /tmp/$2 construction-tools-api:/tmp/$2"; }
case "$1" in
  export)
    cat "$DIR/export.sql" | "$P" "cat > /tmp/cep.sql && docker cp -q /tmp/cep.sql construction-tools-db:/tmp/cep.sql && \
      docker exec construction-tools-db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v n=${2:-100} -v root=$3 -v seed=${4:-$(date +%F)} -f /tmp/cep.sql'" \
      | sed '/^Output format/d;/^Tuples only/d' > "$5"
    echo "exported to $5" ;;
  check)
    up "$2" cep-cards.json; up "$3" cep-texts.json; up "$DIR/check.js" cep-check.js
    "$P" "docker exec construction-tools-api node /tmp/cep-check.js /tmp/cep-cards.json /tmp/cep-texts.json" ;;
  apply)
    up "$2" cep-apply.json; up "$DIR/apply.js" cep-apply.js
    "$P" "docker exec construction-tools-api node /tmp/cep-apply.js /tmp/cep-apply.json" ;;
  mark)
    up "$2" cep-mark.json; up "$DIR/mark-ai.js" cep-mark-ai.js
    "$P" "docker exec construction-tools-api node /tmp/cep-mark-ai.js /tmp/cep-mark.json" ;;
  cleanup)
    "$P" 'rm -f /tmp/cep*; docker exec -u root construction-tools-api sh -c "rm -f /tmp/cep*"; docker exec -u root construction-tools-db sh -c "rm -f /tmp/cep*"; echo cleaned' ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
