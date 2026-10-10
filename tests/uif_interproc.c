/* Unsafe Input Flow: tainted value reaches system() through a helper. */
void run(char* c) {
    system(c);
}
int main() {
    char cmd[128];
    scanf("%s", cmd);
    run(cmd);
    return 0;
}
