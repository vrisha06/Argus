/* Unsafe Input Flow: untrusted input reaches system() in one function. */
int main() {
    char cmd[128];
    scanf("%s", cmd);
    system(cmd);
    return 0;
}
