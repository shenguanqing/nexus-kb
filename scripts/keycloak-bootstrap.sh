#!/bin/sh
set -eu

readonly SERVER_URL='http://keycloak:8080'
readonly REALM='nexuskb-dev'
readonly KCADM='/opt/keycloak/bin/kcadm.sh'

until "$KCADM" config credentials \
  --server "$SERVER_URL" \
  --realm master \
  --user "$KEYCLOAK_TEST_ADMIN_USERNAME" \
  --password "$KEYCLOAK_TEST_ADMIN_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

if ! "$KCADM" get users -r "$REALM" -q "username=$KEYCLOAK_TEST_USERNAME" --fields username \
  --format csv --noquotes | grep -qx "$KEYCLOAK_TEST_USERNAME"; then
  "$KCADM" create users -r "$REALM" \
    -s "username=$KEYCLOAK_TEST_USERNAME" \
    -s 'enabled=true' \
    -s 'emailVerified=true' \
    -s 'email=sso-tester@localhost.test' \
    -s 'firstName=SSO' \
    -s 'lastName=Tester' >/dev/null
fi

"$KCADM" set-password -r "$REALM" \
  --username "$KEYCLOAK_TEST_USERNAME" \
  --new-password "$KEYCLOAK_TEST_USER_PASSWORD" >/dev/null
"$KCADM" add-roles -r "$REALM" \
  --uusername "$KEYCLOAK_TEST_USERNAME" \
  --rolename admin >/dev/null

USER_ID=$("$KCADM" get users -r "$REALM" -q "username=$KEYCLOAK_TEST_USERNAME" \
  --fields id --format csv --noquotes)
"$KCADM" update "users/$USER_ID" -r "$REALM" \
  -s 'email=sso-tester@localhost.test' \
  -s 'firstName=SSO' \
  -s 'lastName=Tester' \
  -s 'requiredActions=[]' >/dev/null

printf '%s\n' "NexusKB local SSO test user is ready."
