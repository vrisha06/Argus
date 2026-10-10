/* Buffer Overflow: tainted input copied into a fixed buffer with strcpy. */
void copy_name(char* input) {
    char buf[16];
    strcpy(buf, input);
}
int main() {
    char input[128];
    scanf("%s", input);
    copy_name(input);
    return 0;
}
