/* File 1 of 2: untrusted input is read here and handed to run() in multi_util.c */
int main() {
    char cmd[128];
    scanf("%s", cmd);
    run(cmd);
    return 0;
}
