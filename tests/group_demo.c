/* Root-cause grouping demo: one scanf feeds two findings, plus two independent bugs. */
void run(char* c) {
    char b[8];
    strcpy(b, c);
    system(c);
}
int main() {
    char n[64];
    scanf("%s", n);
    run(n);

    char* p;
    p = malloc(16);
    *p = 65;
    free(p);
    free(p);
    return 0;
}
