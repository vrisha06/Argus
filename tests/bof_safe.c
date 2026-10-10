/* Safe control: bounded copy with strncpy. */
void copy_name(char* input) {
    char buf[16];
    strncpy(buf, input, 16);
}
int main() {
    char input[128];
    scanf("%s", input);
    copy_name(input);
    return 0;
}
