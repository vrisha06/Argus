/* Memory walkthrough demo: triggers all five walkthrough types. */
void copy_name(char* input) {
    char buf[16];
    strcpy(buf, input);
}
void store(int i) {
    char table[8];
    table[i] = 65;
}
int main() {
    char name[64];
    int idx;
    scanf("%s", name);
    scanf("%d", &idx);
    copy_name(name);
    store(idx);
    system(name);

    char* p;
    p = malloc(16);
    *p = 65;
    free(p);
    *p = 66;
    return 0;
}
