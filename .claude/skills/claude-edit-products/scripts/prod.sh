#!/bin/sh
# Runs a command on the prod box (root@87.232.67.114). Uses an SSH key when one
# works; otherwise the password from PROD_SSH_PASS (never commit it — the repo
# is public). stdin is passed through, so `cat file | prod.sh 'cat > /tmp/x'`
# copies a file.
HOST=${PROD_HOST:-root@87.232.67.114}
if [ -n "$PROD_SSH_PASS" ]; then
  ASK=$(mktemp); printf '#!/bin/sh\nprintf "%%s\\n" "$PROD_SSH_PASS"\n' > "$ASK"; chmod 700 "$ASK"
  SSH_ASKPASS="$ASK" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 PROD_SSH_PASS="$PROD_SSH_PASS" \
    ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password,keyboard-interactive \
        -o ConnectTimeout=15 "$HOST" "$@"
  rc=$?; rm -f "$ASK"; exit $rc
fi
exec ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$HOST" "$@"
