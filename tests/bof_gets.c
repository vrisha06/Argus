/* Buffer Overflow: gets() cannot bound its input. */
int main() {
    char buf[32];
    gets(buf);
    return 0;
}
